# FIREBASE_COSTS — qué cuesta y por qué está diseñado así

El objetivo de este documento es que puedas mirar la factura y **entender cada
número**. También explica las decisiones de arquitectura que existen sólo para
que esa factura sea cero.

Cuotas del plan gratuito (Spark), por día:

| Servicio | Gratis al día |
|---|---|
| Firestore — lecturas | 50.000 |
| Firestore — escrituras | 20.000 |
| Firestore — borrados | 20.000 |
| Firestore — almacenamiento | 1 GiB |
| Realtime Database — descarga | 10 GB/mes |
| Realtime Database — almacenamiento | 1 GB |
| Realtime Database — conexiones simultáneas | 100 |

---

## 1. La decisión que lo cambia todo: dónde va cada dato

| Dato | Base de datos | Frecuencia | Por qué ahí |
|---|---|---|---|
| Posición, dirección, actividad, presencia | **Realtime Database** | ~9/s por jugador | RTDB factura **bytes**, no operaciones |
| Usuario (dinero, XP, inventario, mejoras, misiones) | **Firestore** | sólo al interactuar | transacciones + reglas expresivas |
| Fábrica (nivel, contribución, máquinas) | **Firestore** | sólo al interactuar | estado compartido consistente |
| Miembros (ranking) | **Firestore** | sólo al interactuar | documentos diminutos |

### El cálculo que justifica usar dos bases de datos

Si las posiciones se guardaran en Firestore:

```
9 escrituras/s × 3.600 s × 10 jugadores  = 324.000 escrituras/hora
                                          ≈ 7.776.000 escrituras/día
```

Con 20.000 escrituras gratis al día, eso son **389 veces la cuota**. A ~0,10 €
por 100.000 escrituras, unos **7,80 €/día** sólo para ver caminar a diez
personas.

En Realtime Database, ese mismo tráfico es:

```
~180 bytes por paquete × 9/s × 10 jugadores × 3.600 s ≈ 58 MB/hora
```

y **cada jugador sólo descarga lo de su fábrica**. Con la cuota de 10 GB/mes,
una fábrica activa 4 horas diarias cabe cómodamente.

---

## 2. Qué genera LECTURAS en Firestore

Un jugador mantiene **exactamente 3 listeners** durante toda la sesión:

| Listener | Documentos | Cuándo lee |
|---|---|---|
| `users/{uid}` | 1 | al conectar + cada vez que cambia tu estado |
| `factories/{fid}` | 1 | al conectar + cada vez que alguien interactúa |
| `factories/{fid}/members` | ≤10 | al conectar + cuando alguien cambia su ranking |

Firestore **no cobra por mantener un listener abierto**, sólo por los documentos
que entrega. Un snapshot que no cambia es gratis.

Además, al entrar:

- 1 lectura para cargar el jugador.
- ≤5 lecturas en la consulta de matchmaking (`limit(5)`).
- 1–3 lecturas de la transacción de unión.

**Coste de arranque: ~10 lecturas por sesión.**

### Estimación con 10 jugadores activos 1 hora

Supón 40 interacciones por jugador y hora (cargar, recoger, vender, mejorar):

```
Interacciones totales           = 10 × 40 = 400
Cada una actualiza la fábrica → 400 snapshots × 10 jugadores = 4.000 lecturas
Cada una actualiza tu usuario → 400 × 1                      =   400 lecturas
Members (ranking)             ≈ 400 × 10                     = 4.000 lecturas
Arranque                       = 10 × 10                     =   100 lecturas
                                                             ─────────────────
                                                        ≈ 8.500 lecturas/hora
```

**≈ 6 horas de juego intenso con 10 personas dentro del plan gratuito.**

> El término dominante es *«todos leen cada cambio de fábrica»*. Es inherente a
> un juego cooperativo con estado compartido: si otro sube el nivel de la
> fábrica, tienes que enterarte.

### Cómo bajarlo si hiciera falta

1. **Quitar el listener de `members`** y leer el ranking sólo al abrir el panel:
   ahorra ~47% de las lecturas de golpe.
2. **Separar la fábrica en dos documentos:** uno "caliente" (máquinas) y otro
   "frío" (nivel, stats). La mayoría de interacciones sólo tocarían el caliente.
3. **Agrupar los cambios de máquina** con un pequeño *debounce* de servidor.

---

## 3. Qué genera ESCRITURAS en Firestore

Una escritura por documento afectado, y **sólo** en estas situaciones:

| Acción del jugador | Documentos escritos |
|---|---|
| Extraer mineral | `users` + `factories` (stats) = 2 |
| Cargar en máquina | `users` + `factories` = 2 |
| Recoger producto | `users` + `factories` + `members` = 3 |
| Vender | `users` + `factories` + `members` = 3 |
| Contribuir | `users` + `factories` + `members` = 3 |
| Comprar mejora | `users` + `factories` + `members` = 3 |
| Reclamar misión | `users` + `members` = 2 |
| Latido de sesión (1×/min) | `users` = 1 |
| Entrar a la partida | `users` + `factories` + `members` = 3 |

### Lo que NO genera ni una escritura

Esto es el corazón del diseño:

- ❌ **Moverse.** Va a Realtime Database.
- ❌ **Regenerar estamina.** Se deriva de `(stamina, staminaAt)`.
- ❌ **Las máquinas produciendo.** Se derivan de `cycleStartAt` con
  `settleMachine()`. Una fábrica produciendo 24/7 con nadie conectado genera
  **cero** escrituras y cero lecturas.
- ❌ **Las cintas, los robots, las luces y el humo.** Son render puro.
- ❌ **Que suba la barra de progreso de una máquina.** Se calcula por frame en
  local.

**Estimación con 10 jugadores activos 1 hora:**

```
400 interacciones × ~2,6 documentos ≈ 1.040 escrituras
Latidos: 10 jugadores × 60 min      =   600 escrituras
                                     ─────────────────
                                     ≈ 1.640 escrituras/hora
```

**≈ 12 horas de juego intenso con 10 personas dentro del plan gratuito.**

---

## 4. Realtime Database

### Escrituras

- Sólo mientras el jugador **se mueve**: máximo 1 cada 110 ms (~9/s).
- Parado: 1 latido cada 4 s.
- El paquete es plano y pequeño (~180 bytes con la apariencia incluida).

### Lecturas

Un único `onValue` sobre `presence/{factoryId}`. Firebase envía **sólo los hijos
que cambian**, no el nodo entero.

### Tráfico real con 10 jugadores

```
Peor caso (los 10 corriendo sin parar):
  emisión:  10 × 9/s × 180 B          ≈  16 KB/s
  recepción: cada uno recibe los otros 9 ≈ 146 KB/s en total
  → ~0,5 GB/hora en el peor caso absoluto
```

En la práctica los jugadores están quietos buena parte del tiempo (interactuando
con máquinas o con paneles abiertos), así que el consumo real está entre 5 y 10
veces por debajo. Con la cuota de 10 GB/mes: **decenas de horas de juego real**.

### Almacenamiento

Prácticamente nulo: la presencia se **borra sola** con `onDisconnect().remove()`.
Nunca crece.

---

## 5. Qué pasaría al escalar

| Jugadores por fábrica | Lecturas/hora (aprox.) | Comentario |
|---|---|---|
| 10 | ~8.500 | plan gratuito holgado |
| 20 | ~34.000 | el coste crece **al cuadrado**: cada cambio lo leen más personas |
| 50 | ~212.000 | hay que cambiar de estrategia |
| 100+ | inviable con este esquema | obligatorio particionar |

El crecimiento cuadrático (`interacciones × jugadores`) es el límite real, no el
número de jugadores en sí.

### Plan de escalado (por orden de rentabilidad)

1. **Quitar el listener de `members`** → lectura bajo demanda al abrir el
   ranking. −47% de lecturas, cambio de 5 líneas.
2. **Partir el documento de fábrica** en `state` (frío) y `machines` (caliente).
   La mayoría de interacciones dejan de despertar a todo el mundo.
3. **Presencia por zonas:** `presence/{fid}/{zona}/{uid}` y suscripción sólo a
   las zonas visibles. Imprescindible a partir de ~50.
4. **Cloud Functions con agregación:** las operaciones se acumulan y se escriben
   en lotes cada N ms. Reduce escrituras y contención de transacciones.
5. **Más fábricas, no fábricas más grandes.** Diez fábricas de 10 cuestan
   linealmente; una de 100 cuesta cuadráticamente. El matchmaking ya está
   preparado para repartir.

---

## 6. Optimizaciones ya implementadas

| Técnica | Dónde | Efecto |
|---|---|---|
| Simulación por timestamp | `game/logic/production.ts` | producción sin escrituras |
| Estamina derivada | `game/logic/progression.ts` | regeneración sin escrituras |
| Throttle de posición (110 ms) | `BALANCE.net.positionThrottleMs` | tope duro de escrituras RTDB |
| Latido en reposo (4 s) | `BALANCE.net.idleHeartbeatMs` | presencia fresca casi gratis |
| Interpolación 130 ms | `GameCanvas.tsx` | movimiento fluido con pocos paquetes |
| Inventario como *mapa* en el doc de usuario | `types/index.ts` | 1 lectura en vez de N (subcolección) |
| Máquinas como *mapa* en el doc de fábrica | `types/index.ts` | 1 lectura para toda la fábrica |
| Latido de sesión de 1/min | `ops.tick` | tiempo jugado y misiones sin spam |
| Actualización optimista en cliente | `useSessionStore` | 0 lecturas extra tras cada acción |
| `onDisconnect().remove()` | `firebaseBackend.ts` | 0 basura acumulada en RTDB |
| Sólo 3 listeners por sesión | `useSessionStore` | superficie de lectura mínima |
| Carga diferida del SDK de Firebase | `services/backend/index.ts` | el bundle inicial no lo incluye |

---

## 7. Cómo vigilar el gasto

1. **Consola de Firebase → Uso y facturación.** Revisa lecturas/escrituras por día.
2. **Alertas de presupuesto** en Google Cloud Billing si pasas a Blaze.
3. En desarrollo, usa `VITE_FORCE_LOCAL=true` o los emuladores: **cero cuota**.
4. Si algo se dispara, el sospechoso número uno es un `onSnapshot` nuevo dentro
   de un componente que se remonta. Los listeners del juego se crean en un único
   sitio (`enterGame` en `useSessionStore.ts`) precisamente para que sea fácil
   auditarlos.

---

## 8. Resumen

Con **10 jugadores simultáneos**, el juego consume aproximadamente:

- **~8.500 lecturas** y **~1.640 escrituras** de Firestore por hora de juego intenso.
- **~0,1–0,5 GB/hora** de Realtime Database.

Es decir: **6–12 horas diarias de partida a pleno rendimiento dentro del plan
gratuito**, sin tarjeta de crédito. Y una fábrica produciendo sin nadie dentro
cuesta exactamente **cero**.
