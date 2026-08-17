# ⚙️ IRONLOOP

**Juego incremental multiplayer cooperativo para navegador.**
Hasta 10 operarios comparten una fábrica: la mejoran entre todos, pero cada uno
tiene su propio dinero, inventario, nivel y personaje.

> *La fábrica es de todos. El dinero es tuyo.*

---

## Tabla de contenidos

- [Qué es](#qué-es)
- [Arranque rápido](#arranque-rápido-30-segundos)
- [Modo local vs Firebase](#modo-local-vs-firebase)
- [Configurar Firebase](#configurar-firebase)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Arquitectura multiplayer](#arquitectura-multiplayer)
- [Seguridad](#seguridad)
- [Scripts](#scripts)
- [Despliegue](#despliegue)
- [Añadir contenido](#añadir-contenido-sin-tocar-la-lógica)
- [Documentación adicional](#documentación-adicional)
- [Problemas frecuentes](#problemas-frecuentes)

---

## Qué es

El loop de juego es corto y deliberadamente adictivo:

```
Extraer mineral → llevarlo a la Fundidora → esperar/producir
   → recoger el Lingote → venderlo en el Muelle → ganar dinero + XP
   → comprar una mejora → contribuir al Núcleo
   → la FÁBRICA sube de nivel → cambia visualmente para todos
   → se desbloquean máquinas nuevas → vuelta a empezar, más rápido
```

Lo que es **individual**: dinero, inventario, estamina, nivel, XP, mejoras
personales, apariencia y misiones.
Lo que es **compartido**: nivel de fábrica, máquinas y sus mejoras, zonas
desbloqueadas, multiplicador global de producción y objetivos cooperativos.

Incluido en esta versión:

| Sistema | Estado |
|---|---|
| Login con Google (Firebase Auth) | ✅ |
| Matchmaking automático a fábricas de ≤10 jugadores | ✅ |
| Multiplayer en tiempo real (posición, dirección, actividad, presencia) | ✅ |
| Fábrica renderizada en canvas con luces, humo, cintas y robots | ✅ |
| Cadena de producción completa (extraer → fundir → vender) | ✅ |
| 3 máquinas, 6 recursos, 8 ramas de mejora personal | ✅ |
| Niveles de fábrica que **cambian el mapa** visualmente | ✅ |
| Misiones personales + objetivos cooperativos | ✅ |
| Recompensas offline | ✅ |
| Ranking y presencia | ✅ |
| Personalización modular del personaje | ✅ |
| Estamina, inventario, economía y XP | ✅ |
| Móvil landscape con joystick + escritorio con WASD | ✅ |
| PWA instalable | ✅ |
| Audio procedural (sin archivos) | ✅ |
| Panel de debug/admin | ✅ |
| Prestigio | 🔜 arquitectura preparada |

---

## Arranque rápido (30 segundos)

```bash
npm install
npm run dev
```

Abre <http://localhost:5173> y pulsa **ENTRAR A LA FÁBRICA**.

No hace falta configurar nada: sin credenciales el juego arranca en **modo
local**. Para probar el multiplayer, abre una **segunda pestaña o ventana** con
otro nombre de operario: os veréis y trabajaréis en la misma fábrica.

> Requiere **Node.js 20.19+ o 22.12+** (lo exige Vite 8).

---

## Modo local vs Firebase

El juego habla con un backend a través de una única interfaz (`src/services/backend/types.ts`)
con dos implementaciones intercambiables. **La lógica de juego no sabe cuál está activa.**

| | Modo local | Firebase |
|---|---|---|
| Se activa | sin `.env` (por defecto) | con credenciales en `.env` |
| Persistencia | `localStorage` | Cloud Firestore |
| Tiempo real | `BroadcastChannel` (entre pestañas) | Realtime Database |
| Login | nombre de operario | Google |
| Alcance | un navegador | cualquier dispositivo |
| Coste | 0 | plan Spark gratuito de sobra para 10 jugadores |

El modo local no es una maqueta: ejecuta **exactamente los mismos reductores**
(`src/services/backend/ops.ts`) que Firebase y que las Cloud Functions. Sirve para
desarrollar sin gastar cuota y para que cualquiera pueda probar el juego al clonar el repo.

Para forzar el modo local aun teniendo credenciales: `VITE_FORCE_LOCAL=true`.

---

## Configurar Firebase

Resumen; los pasos detallados con capturas conceptuales están en
**[FIREBASE_SETUP.md](FIREBASE_SETUP.md)**.

1. Crea un proyecto en <https://console.firebase.google.com>.
2. **Authentication** → habilita el proveedor **Google**.
3. **Firestore Database** → crear en modo producción.
4. **Realtime Database** → crear (para posiciones y presencia).
5. Registra una app web y copia la configuración del SDK.
6. Copia el ejemplo de entorno y rellénalo:

```bash
cp .env.example .env
```

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=tu-proyecto.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=tu-proyecto
VITE_FIREBASE_STORAGE_BUCKET=tu-proyecto.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_DATABASE_URL=https://tu-proyecto-default-rtdb.firebaseio.com
```

7. Despliega las reglas de seguridad:

```bash
npm run deploy:rules
```

8. `npm run dev` → ahora el botón es **ENTRAR CON GOOGLE**.

`.env` está en `.gitignore`. **Nunca subas credenciales al repositorio.**

> Las claves web de Firebase no son secretas (van en el bundle del navegador);
> lo que protege tu proyecto son las **Security Rules** y los **dominios
> autorizados**, no ocultar la API key.

---

## Estructura del proyecto

```
ironloop/
├─ src/
│  ├─ config/            ← TODO el contenido, data-driven
│  │  ├─ items.ts          recursos y productos
│  │  ├─ machines.ts       máquinas, recetas, tiempos, costes
│  │  ├─ world.ts          mapa: zonas, estaciones, muros, cintas, robots
│  │  ├─ factoryLevels.ts  progresión compartida y objetivos cooperativos
│  │  ├─ upgrades.ts       árbol de mejoras personales
│  │  ├─ missions.ts       pool de misiones
│  │  ├─ cosmetics.ts      slots de personalización del personaje
│  │  ├─ pets.ts           mascotas cuadrúpedas: chasis, colores y mejoras
│  │  ├─ robots.ts         flota logística: rutas, modos y costes
│  │  ├─ balance.ts        constantes de economía en un único sitio
│  │  └─ env.ts            selección de backend y flags
│  │
│  ├─ types/             ← modelo de dominio compartido
│  │
│  ├─ game/
│  │  ├─ logic/          ← lógica PURA y testeable (sin React ni Firebase)
│  │  │  ├─ production.ts   simulación determinista de máquinas
│  │  │  ├─ progression.ts  XP, estamina, inventario, misiones, offline
│  │  │  └─ defaults.ts     creación y normalización de documentos
│  │  ├─ engine/         ← cámara, entrada, partículas
│  │  ├─ render/         ← dibujo de mundo, máquinas y personajes
│  │  ├─ systems/        ← acciones contextuales
│  │  ├─ world/          ← colisión y detección de interacción
│  │  └─ GameCanvas.tsx  ← bucle principal
│  │
│  ├─ services/
│  │  ├─ backend/
│  │  │  ├─ types.ts        contrato del backend
│  │  │  ├─ ops.ts          ★ reductores transaccionales del juego
│  │  │  ├─ firebase/       implementación Firestore + RTDB
│  │  │  └─ local/          implementación localStorage + BroadcastChannel
│  │  ├─ audio.ts        síntesis WebAudio (sin archivos)
│  │  ├─ bus.ts          eventos de "game feel"
│  │  └─ pwa.ts
│  │
│  ├─ state/             ← stores de zustand (sesión, UI, gameplay)
│  ├─ ui/                ← pantallas, HUD, paneles, overlays
│  ├─ styles/            ← tokens, base, layout, paneles, pantallas
│  └─ utils/
│
├─ functions/            ← Cloud Functions (reutilizan src/services/backend/ops.ts)
├─ tests/                ← 78 tests de los sistemas críticos
├─ scripts/              ← generación de iconos PWA sin dependencias
├─ public/               ← manifest, service worker, iconos
├─ firestore.rules
├─ database.rules.json
└─ firebase.json
```

**Regla de oro del proyecto:** la lógica del juego vive en funciones puras
(`src/game/logic` y `src/services/backend/ops.ts`). El cliente, el backend local
y las Cloud Functions ejecutan **el mismo código**. Por eso los tests valen para
los tres y no hay tres economías distintas que puedan divergir.

---

## Arquitectura multiplayer

### Por qué dos bases de datos

| Dato | Dónde | Frecuencia | Motivo |
|---|---|---|---|
| Posición, dirección, actividad, presencia | **Realtime Database** | ~9 escrituras/s por jugador | RTDB factura por **volumen de datos**, no por operación; además tiene `onDisconnect()` para limpiar solo al cerrar la pestaña |
| Usuario, inventario, dinero, XP, mejoras | **Realtime Database** | sólo al interactuar | Ver abajo: Firestore se quedaba sin cuota en una tarde |
| Fábrica, máquinas, contribución | **Realtime Database** | sólo al interactuar | Ídem |
| Ranking (`members/{uid}`) | **Realtime Database** | sólo al interactuar | Nodos pequeños, un listener por fábrica |

Guardar posiciones en Firestore costaría ~9 escrituras/segundo/jugador: con
10 jugadores serían **~7,8 millones de escrituras al día**, muy por encima del
plan gratuito. En RTDB ese mismo tráfico es un goteo de bytes irrelevante.
El desglose completo está en **[FIREBASE_COSTS.md](FIREBASE_COSTS.md)**.

### Por qué la partida ya no vive en Firestore

Firestore cobra por **operaciones**: 20.000 escrituras al día en el plan
gratuito. Con tres perros picando, cuatro drones repartiendo y el CAEX en ruta,
una partida las agotaba en una tarde y moría con un «Quota exceeded» que además
no explicaba nada. La RTDB cobra por **datos** (10 GB de bajada al mes) y este
juego mueve unos pocos KB por minuto: en la práctica, no se toca.

Lo que hizo falta para mudarse, en `src/services/backend/rtdb/`:

- **`update()` multi-ruta** en lugar de transacción. Es atómico —o entran todas
  las rutas o no entra ninguna—, así que jugador y fábrica siguen cambiando a la
  vez.
- **Contador `rev`** en la fábrica para detectar carreras: cada escritura manda
  `rev + 1` y las reglas exigen que sea exactamente el siguiente. El segundo que
  llegue es rechazado, se refresca y reintenta. Es el «compara y cambia» que
  daba Firestore, hecho a mano.
- **Diff de rutas** (`paths.ts`): no se manda el documento entero en cada recado,
  sólo las hojas que cambiaron. Es lo que mantiene el gasto en KB en vez de MB.

`VITE_BACKEND=firestore` vuelve al backend anterior, que sigue entero y sin
tocar. Los datos de Firestore tampoco se borran: la primera vez que un jugador
entra, `migrate.ts` se los trae a la RTDB tal cual.

> **Orden de despliegue.** Las reglas van SIEMPRE antes que el código:
> `firebase deploy --only database` y después el resto. Si se publica al revés,
> el juego detecta el rechazo y sigue funcionando en Firestore hasta que las
> reglas estén puestas (`caerAFirestore` en `services/backend/index.ts`), pero
> es mejor no depender de la red de seguridad.

### El truco que hace barato el juego: simulación por timestamp

Las máquinas **no se escriben cada tick**. Se guarda únicamente:

```ts
{ level, input: {...}, output: {...}, cycleStartAt, cycles }
```

Cualquier cliente deriva el estado exacto en cualquier instante con
`settleMachine(state, machineId, factoryLevel, now)` — una función pura y
determinista. Sólo se escribe cuando alguien **interactúa** (cargar, recoger,
mejorar), y esa escritura ocurre dentro de una transacción que vuelve a liquidar
la máquina antes de aplicar el cambio.

Consecuencias:
- Una fábrica con las 3 máquinas produciendo 24/7 genera **cero** escrituras.
- Al volver tras 8 horas ves la producción real, no una aproximación.
- Dos jugadores que interactúan a la vez no se pisan: la transacción reintenta.

La estamina usa exactamente la misma idea (`stamina` + `staminaAt`), así que
regenerarse tampoco cuesta ni una escritura.

### Sincronización de jugadores

- Se publica presencia como máximo cada **110 ms** y sólo si el jugador se mueve;
  parado, un latido cada 4 s.
- Los jugadores remotos se **interpolan** 130 ms hacia su última posición: el
  movimiento se ve fluido aunque lleguen 9 paquetes por segundo.
- `onDisconnect().remove()` libera la presencia al cerrar, perder red o
  bloquear el móvil; el progreso persistente **no se toca**.
- Un jugador sin señal durante 20 s desaparece del mapa pero sigue siendo
  miembro de la fábrica y conserva todo su progreso.

### Escalar más allá de 10 jugadores

El límite vive en un único sitio: `BALANCE.factory.maxPlayers`. Para 20–50
basta con subirlo. A partir de ~100 conviene:

1. Particionar la presencia por zonas (`presence/{fid}/{zona}/{uid}`) y
   suscribirse sólo a las zonas visibles.
2. Mover las operaciones a Cloud Functions (`VITE_USE_FUNCTIONS=true`) para
   evitar contención de transacciones en el documento de fábrica.
3. Separar `factories/{fid}/machines/{id}` en subcolección si las escrituras
   concurrentes sobre el documento de fábrica empiezan a reintentar demasiado.

Nada de eso obliga a reescribir la lógica: el contrato `Backend` no cambia.

---

## Seguridad

El cliente se considera hostil. Tres capas:

1. **Nada de escrituras arbitrarias.** Toda mutación pasa por `runOp(...)`, que
   ejecuta un reductor puro dentro de una transacción. El cliente pide
   *«vender»*, no *«ponme 10.000 €»*. Las cantidades se recalculan siempre
   contra el estado real del servidor.
2. **Security Rules** (`firestore.rules`, `database.rules.json`) que acotan el
   daño: nadie escribe el documento de otro, el dinero y la XP tienen techo por
   escritura, el nivel no puede bajar ni saltar, el inventario está limitado y
   las posiciones deben caer dentro del mapa.
3. **Cloud Functions opcionales** (`functions/`): con `VITE_USE_FUNCTIONS=true`
   las operaciones se ejecutan en servidor con **tiempo de servidor** y
   limitación de frecuencia. En ese modo puedes poner las reglas de escritura a
   `allow write: if false` y el cliente pierde toda capacidad de escribir.

Exploit conocido y acotado a propósito en el modo sin Functions: un cliente
manipulado puede adelantar su reloj para liquidar máquinas antes de tiempo.
Como los ciclos están limitados por el material que **realmente** depositó y por
la capacidad del buffer de salida, eso acelera su propia producción pero no crea
recursos de la nada. Con Cloud Functions desaparece por completo.

El panel de debug sólo se monta con `DEBUG_ENABLED` (desarrollo local o
`VITE_ENABLE_DEBUG=true`).

---

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo en :5173 |
| `npm run build` | Comprobación de tipos + build de producción |
| `npm run preview` | Sirve el build |
| `npm test` | 78 tests de economía, producción y progresión |
| `npm run test:watch` | Tests en modo watch |
| `npm run icons` | Regenera los iconos PWA (sin dependencias) |
| `npm run emulators` | Emuladores de Firebase |
| `npm run deploy` | Build + Firebase Hosting |
| `npm run deploy:rules` | Sólo reglas de Firestore y RTDB |
| `npm run deploy:functions` | Sólo Cloud Functions |

---

## Despliegue

### Firebase Hosting (recomendado)

```bash
npm i -g firebase-tools
firebase login
firebase use --add          # selecciona tu proyecto
npm run deploy:all
```

Después, en **Authentication → Settings → Authorized domains**, añade el dominio
de Hosting (`tu-proyecto.web.app`). Sin eso, el login con Google falla.

### GitHub Pages / Netlify / Vercel

`vite.config.ts` usa `base: './'`, así que el build funciona en cualquier
subruta. Define las variables `VITE_*` en el panel del proveedor y añade el
dominio a los dominios autorizados de Firebase Auth.

---

## Añadir contenido sin tocar la lógica

Todo el contenido es data-driven. Ejemplos reales:

**Un recurso nuevo** → una entrada en `src/config/items.ts`.
**Una máquina nueva** → una entrada en `src/config/machines.ts` (receta, tiempo,
capacidad, nivel de desbloqueo y posición en el mapa). Aparece dibujada,
interactuable, mejorable y con su panel, sin tocar el renderer.
**Una zona nueva** → una entrada en `ZONES` de `src/config/world.ts`.
**Un nivel de fábrica más** → una entrada en `FACTORY_LEVELS`; más allá de la
tabla se generan procedimentalmente.
**Una misión** → una entrada en `MISSION_POOL`.
**Un chasis de mascota** → una entrada en `PET_CHASSIS` de `src/config/pets.ts`
+ un caso en `drawShell` de `src/game/render/pet.ts`.

**Una skin** → una opción en `src/config/cosmetics.ts` + un caso en
`src/game/render/character.ts`.

---

## Documentación adicional

- **[GAME_DESIGN.md](GAME_DESIGN.md)** — core loop, economía, curvas de
  progresión, retención, mecánicas futuras y por qué está equilibrado así.
- **[FIREBASE_SETUP.md](FIREBASE_SETUP.md)** — configuración paso a paso.
- **[FIREBASE_COSTS.md](FIREBASE_COSTS.md)** — qué genera lecturas y escrituras,
  números concretos con 10 jugadores y cómo escalar sin sorpresas.

---

## Problemas frecuentes

**«Vite requires Node.js version 20.19+ or 22.12+»**
Actualiza Node. Si además falla con
`Cannot find native binding … @rolldown/binding-*`, es el
[bug de dependencias opcionales de npm](https://github.com/npm/cli/issues/4828):
borra `node_modules` y `package-lock.json` y reinstala con una versión de Node
compatible.

**El login con Google no abre el popup**
El código cae automáticamente a `signInWithRedirect` cuando el popup se bloquea
(típico en móvil). Si falla igual, revisa que el dominio esté en
*Authentication → Settings → Authorized domains*.

**Entro pero no veo a nadie**
En modo local, el multiplayer funciona entre pestañas del **mismo** navegador.
Con Firebase, comprueba que `VITE_FIREBASE_DATABASE_URL` apunta a tu Realtime
Database: sin ella el juego funciona pero nadie se mueve.

**Quiero empezar de cero en modo local**
En la consola del navegador: `localStorage.clear(); sessionStorage.clear()` y recarga.

---

## Licencia

MIT.
