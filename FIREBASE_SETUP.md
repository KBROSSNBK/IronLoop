# FIREBASE_SETUP — configuración paso a paso

Tiempo estimado: **10 minutos**. Todo cabe en el plan gratuito (Spark).

> Recuerda: **el juego funciona sin hacer nada de esto** (modo local con
> localStorage + BroadcastChannel). Esta guía es para tener Google Login y
> multiplayer real entre dispositivos.

---

## 1. Crear el proyecto

1. Entra en <https://console.firebase.google.com> y pulsa **Añadir proyecto**.
2. Nombre: `ironloop` (o el que quieras).
3. Google Analytics: **opcional**, puedes desactivarlo.

---

## 2. Activar Authentication con Google

1. Menú lateral → **Build → Authentication → Get started**.
2. Pestaña **Sign-in method** → **Google** → activar.
3. Elige un *correo de soporte del proyecto* y **Guardar**.

> No se usan contraseñas propias: Firebase Authentication es la única fuente de
> identidad.

---

## 3. Crear Cloud Firestore

1. **Build → Firestore Database → Crear base de datos**.
2. Modo: **producción** (las reglas del repo lo cubren).
3. Ubicación: la más cercana a tus jugadores (`eur3` para Europa).

Colecciones que creará el juego solo (no hay que crearlas a mano):

```
users/{uid}                              perfil, dinero, inventario, mejoras…
factories/{factoryId}                    nivel, contribución, máquinas
factories/{factoryId}/members/{uid}      documento público para el ranking
meta/counters                            contador de fábricas creadas
```

---

## 4. Crear Realtime Database

Es la que hace fluido el multiplayer. Sin ella el juego arranca, pero no verás
moverse a nadie.

1. **Build → Realtime Database → Crear base de datos**.
2. Ubicación: la más cercana.
3. Modo: **bloqueado** (las reglas del repo lo cubren).
4. Copia la URL que aparece arriba, del estilo:
   `https://ironloop-default-rtdb.europe-west1.firebasedatabase.app`

Estructura que usa el juego:

```
presence/{factoryId}/{uid} = { uid, name, level, x, y, dir, act, appearance, t }
```

Se borra sola al desconectar gracias a `onDisconnect().remove()`.

---

## 5. Registrar la app web y copiar la configuración

1. **Configuración del proyecto** (⚙️) → **Tus apps** → icono **web `</>`**.
2. Apodo: `ironloop-web`. **No** marques Firebase Hosting todavía.
3. Copia el objeto `firebaseConfig`.

---

## 6. Rellenar el `.env`

```bash
cp .env.example .env
```

```env
VITE_FIREBASE_API_KEY=AIza...
VITE_FIREBASE_AUTH_DOMAIN=ironloop.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=ironloop
VITE_FIREBASE_STORAGE_BUCKET=ironloop.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012
VITE_FIREBASE_APP_ID=1:123456789012:web:abc123
VITE_FIREBASE_DATABASE_URL=https://ironloop-default-rtdb.europe-west1.firebasedatabase.app
```

Reinicia `npm run dev`. El botón debe cambiar a **ENTRAR CON GOOGLE**.

> `.env` está en `.gitignore`. Las claves web de Firebase viajan igualmente en
> el bundle del navegador y **no son secretas**: lo que protege el proyecto son
> las Security Rules y los dominios autorizados.

---

## 7. Dominios autorizados

**Authentication → Settings → Authorized domains.** Debe estar:

- `localhost` (viene por defecto)
- tu dominio de producción (`ironloop.web.app`, tu dominio propio, `*.vercel.app`…)

Si falta, el login con Google devuelve `auth/unauthorized-domain`. El juego lo
detecta y muestra un mensaje explícito.

---

## 7b. Login fiable en móvil (opcional)

Por defecto el login usa `<proyecto>.firebaseapp.com` como `authDomain`. Eso
significa que el diálogo de Google vive en **otro dominio** distinto al de tu
app, así que depende de cookies de terceros. Safari/iOS las bloquea por
defecto y Chrome está en ello, de modo que `signInWithRedirect` puede fallar en
bastantes móviles.

La solución recomendada por Firebase es servir el handler de OAuth desde **tu
propio dominio**. Firebase Hosting ya lo publica en `/__/auth/handler`, pero
Google sólo autoriza automáticamente el redirect de `firebaseapp.com`, así que
hay que darlo de alta a mano:

1. <https://console.cloud.google.com/apis/credentials> (elige tu proyecto).
2. En **ID de cliente de OAuth 2.0**, abre el llamado
   *Web client (auto created by Google Service)*.
3. En **URI de redireccionamiento autorizados**, añade:

   ```
   https://TU-PROYECTO.web.app/__/auth/handler
   ```

   (y el de tu dominio propio, si tienes uno).
4. Guarda y espera un par de minutos a que propague.
5. En `.env`:

   ```env
   VITE_AUTH_SAME_ORIGIN=true
   ```

6. `npm run deploy`.

> ⚠️ Si activas `VITE_AUTH_SAME_ORIGIN=true` **sin** hacer los pasos 1–4, el
> login fallará con `Error 400: redirect_uri_mismatch`. Con la opción en
> `false` (el valor por defecto) todo funciona sin tocar nada.

---

## 8. Desplegar las Security Rules

```bash
npm i -g firebase-tools
firebase login
firebase use --add        # elige tu proyecto y ponle el alias "default"
npm run deploy:rules
```

Esto sube `firestore.rules` y `database.rules.json`. **No juegues en producción
sin este paso:** por defecto Firestore en modo producción deniega todo y el
juego no podrá leer ni escribir.

### Índice de Firestore

El matchmaking consulta `where('playerCount','<',10).orderBy('playerCount','desc')`.
Firestore lo resuelve con un índice de un solo campo, que se crea solo. Si aun
así la consola pidiera un índice compuesto, `firestore.indexes.json` ya lo
declara:

```bash
firebase deploy --only firestore:indexes
```

---

## 9. Cloud Functions (opcional pero recomendado en producción)

Las Functions ejecutan las operaciones de juego en servidor, con **tiempo de
servidor** y limitación de frecuencia. Requieren plan **Blaze** (de pago por
uso; para 10 jugadores el coste real es prácticamente cero, pero exige tarjeta).

```bash
cd functions
npm install
cd ..
npm run deploy:functions
```

Luego activa en `.env`:

```env
VITE_USE_FUNCTIONS=true
```

Y endurece `firestore.rules` cambiando los `allow create/update` de `users` y
`factories` por `allow write: if false` (hay un bloque comentado al final del
archivo explicándolo). A partir de ahí, un cliente manipulado **no puede
escribir nada**.

---

## 10. Desplegar el juego

```bash
npm run build
firebase deploy --only hosting
```

O todo de una vez:

```bash
npm run deploy:all
```

Tu juego queda en `https://TU-PROYECTO.web.app`.
Añade ese dominio a *Authorized domains* (paso 7).

---

## Desarrollo con emuladores (sin tocar producción)

```bash
firebase emulators:start
```

Levanta Auth (9099), Firestore (8080), Realtime Database (9000), Functions
(5001) y una UI en <http://localhost:4000>. Útil para probar las reglas de
seguridad de verdad antes de desplegarlas.

---

## Verificación final

| Comprobación | Cómo |
|---|---|
| Login funciona | El botón abre el selector de cuenta de Google |
| Firestore escribe | En la consola aparece `users/{tu-uid}` con `money: 500` |
| RTDB funciona | Con el juego abierto, `presence/{factoryId}/{uid}` existe y cambia al moverte |
| `onDisconnect` funciona | Cierra la pestaña: el nodo de presencia desaparece solo |
| Reglas activas | Desde otra cuenta, intenta escribir en `users/{uid}` ajeno → permiso denegado |
| Multiplayer real | Dos dispositivos, dos cuentas de Google, misma fábrica |

---

## Problemas frecuentes

| Síntoma | Causa | Solución |
|---|---|---|
| `auth/unauthorized-domain` | Dominio no autorizado | Paso 7 |
| `auth/configuration-not-found` | Proveedor Google sin activar | Paso 2 |
| `permission-denied` al entrar | Reglas sin desplegar | Paso 8 |
| Nadie se mueve | Falta `VITE_FIREBASE_DATABASE_URL` | Paso 4 |
| El popup no abre en móvil | Bloqueo de popups | Ya contemplado: cae a `signInWithRedirect` |
| Sigo en modo local con `.env` puesto | Vite no relee `.env` en caliente | Reinicia `npm run dev` |
| Sigo en modo local | `VITE_FORCE_LOCAL=true` | Ponlo a `false` |
