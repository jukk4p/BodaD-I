# Rediseño premium de la galería en vivo

**Fecha:** 2026-10-19
**Proyecto:** BodaD-I (invitación-dani-irene) — boda de Daniel & Irene, 2026-10-24
**Estado:** Pendiente de aprobación

## Intención y por qué

La galería en vivo (`galeria.html`) ya funciona de extremo a extremo: los invitados suben fotos/vídeos desde `subir.html`, un workflow de n8n los guarda en una carpeta de Google Drive, y `galeria.html` los lista vía un webhook de n8n que consulta Drive.

El problema no es funcional, es de percepción visual: al depender de los endpoints públicos de Drive (`thumbnail?id=`, `uc?export=view`, `file/d/{id}/preview`), el diseño queda limitado a lo que Drive permite — miniaturas con rate-limiting agresivo, un iframe de vídeo que dibuja su propia UI de "abrir en Drive" (solo se puede tapar con una capa, no quitar), y una proporción de celda forzada a 16:9 que no encaja con el contenido real: la inmensa mayoría de fotos y vídeos los sacará gente con el móvil, mayormente en vertical. El resultado se percibe "cutre"/básico, no a la altura del resto de la invitación (ya cuidada tipográfica y visualmente).

La decisión, tomada en conversación con el dueño del proyecto: dejar de depender de los embeds de Drive para la presentación, y servir las fotos/vídeos desde el propio VPS donde ya vive el sitio. Esto habilita un diseño "Editorial Masonry" con miniaturas reales, proporciones correctas y un reproductor de vídeo propio.

## Restricción de tiempo — leer primero

**La boda es el 2026-10-24.** Hoy es 2026-10-19: quedan 5 días. `galeria.html`, `subir.html` e `index.html` tienen un candado por fecha (`galleryActive` / `uploadActive` / `recuerdosActive`, comparando `Date.now()` contra `2026-10-24T00:00:00`) que se desbloquea solo, automáticamente, ese día — no hay despliegue manual que lo active.

Esto implica:
- Hay que terminar de construir, probar end-to-end en producción (igual que se hizo con el diseño anterior: subida real de foto y vídeo de prueba, verificación visual) y dejarlo estable **antes del 24**, con margen para detectar y arreglar problemas.
- Si algo no llega a tiempo o falla en producción cerca de la fecha, el plan de contingencia es **no tocar nada el día 23-24**: dejar la última versión estable desplegada, aunque sea con alguna limitación visual, antes que arriesgar una rotura justo cuando se active para los invitados reales.
- No hay margen para migraciones de datos: no hay fotos/vídeos reales de invitados todavía (los de prueba ya se limpiaron de Drive), así que no hace falta portar nada existente — se empieza en limpio en el almacenamiento nuevo.

## Objetivos

- La galería se ve como una pieza de diseño cuidada (mosaico tipo Pinterest/editorial), coherente con la tipografía (Fraunces + Archivo) y paleta (tinta azul + oro) ya usadas en el resto del sitio.
- Las fotos y vídeos se muestran con su proporción real (la mayoría serán verticales, de móvil) — nada de recortes forzados a 16:9.
- Los vídeos se reproducen con controles propios del sitio, sin marca de Google Drive visible en ningún punto.
- El lightbox permite recorrer todo el álbum con flechas ← → y un contador de posición ("12 / 48"), no solo ver un elemento suelto.
- Sigue funcionando el polling en vivo (nuevas fotos/vídeos aparecen sin recargar) y el candado por fecha de boda, igual que ahora.

## No-objetivos

- No se rediseña `subir.html` (la pantalla de subida) — sigue igual, solo cambia qué hace n8n con el archivo una vez subido.
- No se cambia el límite de tamaño de archivo (50MB) ni los tipos aceptados (`image/*`, `video/*`).
- No se migra nada del proyecto hermano `invitacion-editorial` (Gloria & José) en este trabajo — si se quiere portar luego, es una tarea aparte.
- No se sustituye n8n por otro backend — se modifica el workflow existente, no se reemplaza la orquestación.

## Anti-objetivos (qué sería un fracaso aunque "funcione")

- Que la migración de almacenamiento retrase o ponga en riesgo que la galería esté lista y probada antes del 24 de octubre.
- Que el nuevo pipeline de vídeo/imagen consuma tanto disco o CPU que afecte a los otros servicios que ya corren en el mismo VPS (n8n, otros proyectos).
- Que se pierda la capacidad de desactivar la sección antes de la fecha de boda (el candado por fecha debe seguir intacto).

## Restricciones

- **Infraestructura confirmada (Coolify):** la app `Boda-Dani` en Coolify está desplegada como "Static" (`nginx:alpine`), reconstruida desde git en cada push, y **hoy no tiene ningún volumen persistente configurado** ("No storage found" en su panel de Persistent Storage). Esto significa que el primer paso de implementación, antes de tocar n8n o el frontend, es configurar en Coolify un volumen persistente para `Boda-Dani` y su ruta de servido estático para `/uploads/...` — sin esto no hay forma de probar nada end-to-end. No es solo un cambio de código, es también un cambio de configuración de infraestructura.
- **Seguridad de los archivos servidos:** a diferencia de los enlaces de Drive (IDs largos no adivinables), servir desde una carpeta propia con nombres basados en timestamp los hace predecibles. El nombre de archivo final debe combinar el prefijo de timestamp (para poder ordenar) con un componente aleatorio no adivinable, y el servidor debe tener desactivado el listado de directorio (`autoindex off` en nginx) para `/uploads/`.
- **Backup del workflow de n8n:** antes de editar el workflow de producción (el paso de guardado en Drive se sustituye, no se añade en paralelo), hay que exportar/duplicar el workflow actual como backup recuperable — el plan de contingencia de "no tocar nada el 23-24" solo es ejecutable si existe algo a lo que volver.
- **Disco:** VPS-2 de OVHcloud, 73GB totales, 51GB libres confirmados (31% usado) a fecha de este documento. La huella estimada de la galería completa (fotos + vídeos de ~100-200 invitados, con miniaturas) es de 5-15GB — hay margen amplio, pero el volumen de almacenamiento debe ser persistente (sobrevivir a redeploys del contenedor).
- **CPU/RAM:** mismo VPS aloja n8n (con Postgres) y otros proyectos vía Coolify; CPU ~16-30%, RAM ~38-40% en el momento de medir, con 11 servicios ya corriendo. Hay margen, pero tanto la generación de miniaturas/pósters como la transcodificación de vídeo deben procesarse de uno en uno al subirse (no en lote), para no competir por CPU con n8n ni con el resto de servicios durante el día de la boda, cuando probablemente lleguen varias subidas seguidas.
- **Infraestructura:** todo se gestiona vía Coolify; el despliegue del sitio estático sigue el mismo mecanismo actual (push a `origin/master` se refleja en producción en segundos, por un mecanismo externo a este repo).
- **Compatibilidad:** el candado por fecha (`galleryActive`/`uploadActive`/`recuerdosActive`) y el patrón de polling cada 20s deben mantenerse tal cual funcionan hoy.

## Las decisiones de arquitectura ya tomadas

**Cambio respecto a la versión original de este documento:** el plan original asumía que el procesado (ffmpeg, escritura en disco) se haría con nodos "Execute Command" dentro de los workflows de n8n. Al empezar a implementar se descubrió que n8n desactiva ese nodo por defecto desde su versión 2.0 (que es la que corre esta instancia), precisamente por el riesgo de seguridad de permitir ejecución de comandos arbitrarios en una instancia que acepta webhooks públicos. En vez de reactivarlo (ampliaría la superficie de ataque de toda la instancia de n8n, no solo de este flujo), se decidió: un servicio propio pequeño que hace el trabajo de procesado, y n8n queda como un simple reenviador HTTP.

1. **Servicio de medios (`media-service`):** una aplicación Node.js + Express nueva, en su propio contenedor Docker gestionado por Coolify, con acceso de escritura al mismo volumen compartido que `Boda-Dani` sirve como estáticos. Expone dos endpoints:
   - `POST /upload` — recibe el archivo original (multipart) y su tipo MIME; genera un id no adivinable (`{timestampMs}_{random8hex}`); guarda el original; genera la miniatura de grid (fotos) o el póster + vídeo transcodificado (vídeos) ejecutando `ffmpeg`/`ffprobe` vía `child_process.spawn` con arrays de argumentos explícitos (nunca interpolando texto en una cadena de shell, así no hay ninguna vía de inyección a través del nombre de archivo del invitado); añade la línea correspondiente a `manifest.jsonl` solo si todo lo anterior tuvo éxito; devuelve el JSON del item.
   - `GET /list` — lee `manifest.jsonl` y devuelve el array JSON tal cual.
   El propio contenedor del servicio incluye `ffmpeg` en su imagen Docker — no depende de qué tenga instalado n8n.
2. **Almacenamiento:** el paso final del workflow de n8n que hoy sube el archivo a Google Drive se sustituye por un nodo HTTP Request que reenvía el archivo recibido por el webhook a `media-service`'s `POST /upload`. El volumen Docker que `media-service` usa para guardar todo es el mismo volumen persistente del VPS ya montado en `Boda-Dani` (fuera del contenedor, sobrevive a redeploys).
3. **Procesado al subir** (ahora dentro de `media-service`, no en n8n):
   - Para fotos: una versión redimensionada/optimizada para el grid (el original se conserva para el lightbox a tamaño completo).
   - Para vídeos: una imagen póster (primer frame) para usarla como miniatura en el grid, evitando cargar el vídeo completo solo para mostrarlo en el mosaico; **y además una transcodificación a un formato ampliamente compatible (H.264/AAC en MP4)**, para que la reproducción con el `<video>` propio sea fiable en cualquier navegador/dispositivo de los invitados, en vez de servir el archivo original del móvil tal cual. Decisión explícita: se prioriza la fiabilidad de reproducción sobre el tiempo de implementación, asumiendo el coste extra de CPU/tiempo de procesado que esto implica bajo el plazo ajustado (ver "Restricción de tiempo").
4. **Servido:** esa carpeta se expone como archivos estáticos bajo el mismo dominio (`bodadaniyirene.ivangonzalez.cloud/uploads/...`) — se aprovecha el despliegue existente del sitio para esto; `media-service` solo escribe ahí, no sirve tráfico público él mismo (nginx en `Boda-Dani` es quien sirve los archivos).
5. **Listado:** el webhook de listado (`boda-daniel-irene-galeria`) deja de consultar Google Drive y pasa a ser un simple reenvío HTTP a `media-service`'s `GET /list`. Devuelve URLs directas a: imagen original, imagen optimizada, póster (si es vídeo), vídeo original. El frontend deja de construir URLs de Drive y usa directamente lo que devuelve el webhook.
6. **Reproducción de vídeo:** se sustituye el `<iframe src="drive.google.com/.../preview">` por un `<video>` HTML real apuntando al archivo servido desde el propio dominio — esto es lo que elimina la marca de Drive y permite controles propios.
7. **Diseño visual — Editorial Masonry:** mosaico con columnas de ancho fijo donde cada celda ocupa 1 o 2 filas según la proporción real de la imagen/vídeo (conservando su aspect ratio, sin recortar a la fuerza), zoom suave al pasar el ratón, entrada escalonada (fade + slide) al cargar cada tanda nueva. Los vídeos muestran su póster en el grid; al abrirse en el lightbox es cuando se reproduce el `<video>` real.
8. **Lightbox:** se amplía el actual (ya tiene overlay + cierre con Escape/click fuera) para navegar con flechas ← → entre todos los elementos cargados y mostrar un contador de posición.

## Lo que queda a criterio de quien lo construya

- Parámetros concretos de transcodificación (resolución máxima, bitrate, preset de `ffmpeg`) buscando el equilibrio entre tiempo de procesado y calidad.
- Mecanismo concreto para el layout masonry en CSS/JS (columnas CSS con `column-count`, o CSS Grid con alto de celda calculado por JS a partir de `naturalWidth`/`naturalHeight` del elemento) — cualquiera de los dos cumple el objetivo, se elige por simplicidad de implementación.
- Diseño exacto de los controles del reproductor de vídeo propio (controles nativos del navegador con CSS personalizado vía `::-webkit-media-controls`, o controles completamente custom construidos en JS) — mientras no muestre nada de Drive y encaje con la paleta del sitio, cualquiera vale.
- Nombre/estructura de subcarpetas dentro del volumen persistente (p. ej. `/data/boda-daniel-irene/{originals,thumbnails,posters}/`) y convención de nombres de archivo — debe seguir permitiendo ordenar por fecha de subida igual que hoy (el código actual usa un prefijo de timestamp en el nombre de archivo; mantener ese patrón o uno equivalente).
- Si el polling del listado sigue siendo cada 20s o se ajusta — no es un requisito cambiarlo, pero no es una decisión cerrada.

## Plan de validación

Antes de considerar esto terminado, igual que se hizo con el rediseño anterior:
- Subida real de prueba de una foto vertical y un vídeo vertical corto (móvil), verificando en producción (no en local, por las peculiaridades de Drive/CORS que ya se vieron) que ambos aparecen con su proporción correcta y sin marca de Drive.
- Verificar que el vídeo transcodificado reproduce correctamente en al menos un par de combinaciones navegador/dispositivo distintas (p. ej. Safari iOS y Chrome Android), ya que esa fiabilidad entre dispositivos es el motivo por el que se decidió transcodificar.
- Verificar que el candado por fecha sigue bloqueando la sección hasta el 24 de octubre (no desplegar con el flag forzado a `true`).
- Confirmar que el consumo de disco/CPU del VPS no se dispara tras la subida de varios archivos de prueba.
