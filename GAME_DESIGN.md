# GAME DESIGN — IRONLOOP

Documento de diseño del MVP y de la dirección posterior. Todo lo descrito aquí
como *implementado* está en el código; lo marcado como *futuro* tiene la
arquitectura preparada pero no está construido.

---

## 1. Pilar de diseño

> **La fábrica es de todos. El dinero es tuyo.**

Toda decisión se valida contra esa frase. Si una mecánica hace que ayudar a los
demás sea malo para ti, se descarta. Si una mecánica hace que tu progreso
personal sea irrelevante, también.

De ahí salen tres tensiones que sostienen el juego:

| Tensión | Cómo se resuelve |
|---|---|
| Egoísmo vs cooperación | El dinero gastado en mejoras personales **también** alimenta la fábrica (35%). Nunca "pierdes" por invertir en ti. |
| Automatizar vs jugar | Cada nivel de automatización elimina trabajo manual pero abre trabajo de mayor nivel. |
| Sesión corta vs sesión larga | El loop base dura ~40 s. Los objetivos de fábrica duran días. |

---

## 2. Core loop

### Loop de 40 segundos (micro)

```
Extraer mineral (⛏ 0,9 s, −4 estamina, +5 XP)
   ↓
Caminar a la Fundidora
   ↓
Cargar (lote de 5, +2 XP/unidad)
   ↓  la máquina arranca: llama, humo, LED verde, barra de progreso
Recoger lingotes (+4 XP/unidad, +1,4 contribución/unidad)
   ↓
Vender en el Muelle (+$18/lingote, +XP, +22% del importe en contribución)
   ↓
"Me falta poco para la siguiente mejora"
```

### Loop de 10 minutos (medio)

```
Varios ciclos micro → comprar una mejora personal
   → la mejora cambia cómo se siente el juego (más rápido, más carga, más huecos)
   → completar una misión → subir de nivel → desbloquear una rama nueva
   → donar al Núcleo cuando sobra dinero
```

### Loop de días (macro)

```
La fábrica sube de nivel
   → la NAVE CAMBIA VISUALMENTE (cintas que giran, robots que patrullan,
     luces, zonas que despiertan)
   → se desbloquea una máquina nueva → nueva cadena de producción
   → producción offline mayor → más razones para volver mañana
```

El punto clave de retención es el tercero: **el cambio visual es la recompensa**.
Un número que sube es olvidable; una nave que enciende las luces y arranca las
cintas delante de ti, no.

---

## 3. Economía

### Cadena de producción

| Paso | Entrada | Salida | Ciclo base | Desbloqueo |
|---|---|---|---|---|
| Yacimiento | — | 1× Mineral | 0,9 s (jugador) | nivel 1 |
| Fundidora MK-I | 2× Mineral | 1× Lingote | 4,2 s | nivel 1 |
| Ensambladora A-7 | 2× Lingote | 1× Engranaje | 7,0 s | nivel 3 |
| Laboratorio Q | 2× Engranaje + 1× Cristal | 1× Circuito | 12,0 s | nivel 6 |

Precios de venta: Mineral $4 · Chatarra $2 · Lingote $18 · Engranaje $58 ·
Cristal $95 · Circuito $190.

El margen crece con la profundidad de la cadena: 2 minerales ($8) → 1 lingote
($18) → 2 lingotes ($36) → 1 engranaje ($58). Refinar siempre gana, pero exige
más tiempo de máquina, que es el recurso realmente escaso.

### Fuentes de contribución a la fábrica

| Acción | Contribución |
|---|---|
| Recoger producto de una máquina | 1,4 por unidad |
| Vender mercancía | 22% del importe |
| Donar dinero al Núcleo | 0,9 por $1 |
| Donar materiales | valor de contribución del item |
| Comprar una mejora personal | 35% del coste |
| Mejorar una máquina | 55% del coste |
| Producción offline | 15% de las unidades |

**Por qué el 35% de las mejoras personales.** Sin él, gastar en ti sería
"traicionar" a la fábrica y el juego castigaría al jugador que quiere progresar.
Con él, cada compra egoísta empuja un poco el proyecto común: la decisión deja
de ser moral y pasa a ser táctica.

### Curvas

- **Coste de mejora personal:** `base × growth^nivel`, con growth entre 1,42 y
  1,68 según la rama. Las ramas potentes (fuerza, comercio, suerte) escalan más.
- **XP para subir de nivel:** `100 × nivel^1,42`. Deliberadamente suave al
  principio: los cinco primeros niveles llegan en los primeros minutos.
- **Recompensa por nivel:** `120 × 1,28^(nivel−1)`, para que subir de nivel
  siempre se traduzca en una compra posible.
- **Contribución de fábrica:** ×1,85 aproximado por nivel más allá del 10.

### Sumideros de dinero

Un incremental muere cuando el dinero deja de tener destino. Aquí hay tres
sumideros que escalan a ritmos distintos:

1. **Mejoras personales** (8 ramas × 12–20 niveles, crecimiento 1,42–1,68).
2. **Mejoras de máquina** (20 niveles, crecimiento 1,62) — compartidas.
3. **Donaciones al Núcleo** — sumidero infinito por definición.

Cuando las mejoras personales se agotan, las de máquina siguen valiendo la pena
porque benefician a todo el mundo, incluido tú.

---

## 4. Progresión de la fábrica

| Nivel | Título | Qué cambia visualmente | Desbloquea |
|---|---|---|---|
| 1 | Nave Abandonada | luces mínimas, todo manual | Fundidora |
| 2 | Primeras Cintas | **las cintas empiezan a girar** | +15% producción |
| 3 | Línea de Ensamblaje | despierta la zona de ensamblaje | Ensambladora, Engranajes |
| 4 | Semi-Automática | más cintas activas | brazos robóticos |
| 5 | Unidades Autónomas | **aparece el primer robot patrullando** | producción offline real |
| 6 | Laboratorio Q | despierta el ala de investigación | Laboratorio, Circuitos |
| 7 | Expansión Norte | segundo robot | zona ampliada |
| 8 | Red Neuronal | terminales activas | IA logística |
| 9 | Mega Fábrica | tercer robot | bonus global |
| 10 | Complejo Futurista | neón al máximo, oscuridad mínima | prestigio disponible |

Además, cada nivel reduce la oscuridad ambiental y añade franjas de neón a los
muros: la nave **literalmente se enciende** conforme progresa. El suelo se
re-rasteriza sólo cuando cambia el nivel (ver README § arquitectura).

Más allá del 10 los niveles se generan procedimentalmente, así que el juego
nunca se queda sin progresión mientras se diseña contenido nuevo.

---

## 5. Automatización y semi-automatización

La regla es: **la automatización nunca elimina al jugador, lo asciende.**

| Antes | Después | Trabajo nuevo |
|---|---|---|
| Llevar mineral a mano | Cintas transportadoras | Decidir qué máquina alimentar |
| Vigilar una máquina | Producción offline | Equilibrar buffers de entrada/salida |
| Transportar producto | Robots de transporte | Mejorar máquinas, coordinar el nivel de fábrica |
| Picar en la veta | Mascota cuadrúpeda | Elegir dónde plantarse y qué mejorar |

### La mascota

Cada jugador tiene una. Es **individual** (chasis, color, mejoras y mochila
propia) y su regla de decisión es deliberadamente simple, para que se entienda
mirándola dos segundos:

1. ¿Hay una zona de extracción dentro del radio de su sensor y le cabe algo?
   → va y mina. La minería gana siempre.
2. ¿Está llena, o no hay nada que minar cerca? → vuelve y te entrega el material.
3. ¿Ni una cosa ni la otra? → te sigue.

Su extracción se simula en cliente y se liquida por tandas contra el servidor,
acotada por el ritmo real de la mascota: automatiza el paseo, no la progresión
(rinde un 40% de la XP de picar tú mismo).

Los buffers son la herramienta de diseño clave: una máquina con la salida llena
**se atasca** (`blocked: 'output-full'`). Eso obliga a volver, aunque todo lo
demás esté automatizado, y crea el patrón "reviso la fábrica cada X minutos" que
sostiene los idle games.

---

## 6. Estamina

La estamina es el limitador de sesión activa, no un muro:

- 100 base, +25 por nivel de *Batería Metabólica* (hasta 20 niveles).
- Regenera 1,6/s de base, +0,65/s por nivel de *Regulador Metabólico*.
- Extraer cuesta 4; cargar y recoger, casi nada; correr cuesta 11/s.

Se deriva de un par `(valor, instante)`, igual que las máquinas: regenera
correctamente aunque el juego esté cerrado y **no cuesta ni una escritura**.

Al agotarse el jugador no se bloquea: sigue caminando y recogiendo producto, sólo
no puede extraer. Nunca hay una pantalla de "espera 10 minutos".

---

## 7. Retención

| Mecanismo | Ventana | Estado |
|---|---|---|
| Misiones personales (3 activas, se reponen) | minutos | ✅ |
| Subida de nivel con recompensa | minutos | ✅ |
| Objetivos cooperativos de fábrica | horas/días | ✅ |
| Nivel de fábrica y cambio visual | días | ✅ |
| Producción offline (tope 8 h) | cada sesión | ✅ |
| Presencia: ver a otros trabajando | siempre | ✅ |
| Ranking por contribución | días | ✅ |
| Eventos temporales | horas | 🔜 |
| Prestigio | semanas | 🔜 |

**Tope offline a 8 horas** a propósito: premia volver una o dos veces al día sin
que desaparecer una semana sea equivalente a jugar.

---

## 8. Game feel

Cada acción del jugador dispara una cadena de retroalimentación, no un número:

```
Cargar mineral
 → partículas en el punto de carga
 → anillo de energía
 → la máquina arranca: llama animada, humo, LED verde, barra de progreso
 → sonido sintetizado
 → "+2 XP" flotante
 → la barra de XP del HUD avanza
```

Reglas que se siguen en el código:

- **Respuesta inmediata:** la UI se actualiza optimísticamente al confirmar la
  operación; el listener sólo reconcilia.
- **Nada bloquea el movimiento** más de ~0,3 s salvo extraer (0,9 s).
- **Mantener pulsado repite** la acción principal si es sostenible: minar es
  fluido, no un clicker.
- **Sacudida de cámara** reservada a subidas de nivel (6) y nivel de fábrica
  (12–14). Si se usa para todo, deja de significar algo.
- **Sin muros de texto:** los avisos son toasts de una línea con icono y tono.

---

## 9. Multiplayer y cooperación

- Máximo 10 operarios por fábrica (`BALANCE.factory.maxPlayers`).
- Matchmaking automático que **prioriza fábricas con gente**: entrar a un mundo
  vacío es la peor primera impresión posible.
- Cada jugador ve a los demás con su apariencia real, nombre y nivel.
- El ranking mide contribución, producción, ventas, dinero y nivel: cinco formas
  de ser el mejor, para que nadie quede sistemáticamente último.

Competencia dentro de la cooperación: el ranking ordena por **contribución a la
fábrica**, así que "ganar" es exactamente lo mismo que "ayudar más".

---

## 10. Monetización futura (no implementada)

Diseñada como **cosmética pura**, nunca pay-to-win:

- Skins, colores y accesorios adicionales (el sistema modular ya los soporta:
  las opciones marcadas `premium: true` en `cosmetics.ts` son el gancho).
- Efectos de partículas personales, mascotas, emotes.
- Decoración de la fábrica (visible para todos: valor social real).
- Pase de temporada con objetivos cosméticos.

Lo que **nunca** se venderá: dinero, recursos, velocidad, estamina, niveles de
máquina ni de fábrica.

---

## 11. Mecánicas futuras

| Mecánica | Idea | Preparación en el código |
|---|---|---|
| **Prestigio** | Reiniciar la fábrica a cambio de Tokens de Tecnología con bonus permanentes | campo `prestige` en `FactoryState`, `PRESTIGE_UNLOCK_LEVEL` |
| **Eventos temporales** | Hora Pico (+50% producción), Máquina Descontrolada (reparación urgente), Pedido Especial (objetivo colectivo con bonus) | el bus de eventos y los objetivos de fábrica ya soportan contadores compartidos |
| **Reparación** | Las máquinas se averían y hay que repararlas | `MachineState` admite campos nuevos sin migración (`normalizeFactory`) |
| **Nuevas zonas** | Mina, Central Eléctrica, Puerto, Centro de Investigación | añadir entradas en `ZONES` y `STATIONS` |
| **Mercado entre jugadores** | Vender excedentes a otros operarios | requiere una operación nueva en `ops.ts` |
| **Clanes / fábricas privadas** | Códigos de invitación, fábricas privadas | `joinFactory` ya está aislado tras el contrato `Backend` |
| **Energía** | Recurso que limita cuántas máquinas funcionan a la vez | tensión de diseño excelente: obliga a priorizar |

**Norma de proceso:** ninguna mecánica grande se implementa sin documentarla
antes en este archivo.

---

## 12. Decisiones de diseño no obvias

**Por qué el depósito es por lotes de 5 y no "toda la mochila".**
Vaciar la mochila de un botonazo elimina la sensación de transportar. Un lote
por acción mantiene el gesto físico; la mejora de Exoesqueleto lo multiplica, y
esa mejora se siente inmediatamente.

**Por qué las máquinas se atascan con la salida llena.**
Es el único freno que evita que la fábrica se vuelva un simulador de espera. Un
buffer lleno es una llamada explícita: "vuelve, hay trabajo".

**Por qué la estamina no bloquea caminar.**
Un jugador sin estamina que tampoco puede moverse abandona la sesión. Sin
estamina puedes seguir recogiendo, vendiendo, mejorando y contribuyendo: sólo se
te cierra la extracción, que es la actividad más repetitiva.

**Por qué el matchmaking prefiere fábricas llenas.**
Un mundo cooperativo vacío se siente roto. Es preferible que ocho personas
compartan una fábrica viva a que ocho fábricas tengan una persona cada una.

**Por qué el dinero no es global.**
Un monedero compartido convierte cualquier gasto en una discusión y premia al
free rider. Con dinero individual y contribución voluntaria, ayudar es una
elección visible que el ranking recompensa.
