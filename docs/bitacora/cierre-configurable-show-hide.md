# Bitácora - cierre configurable de Mostrar/Ocultar

## 1. `apps/viewer/src/flipbook.js`

- Archivo tocado: `apps/viewer/src/flipbook.js`
- Función o bloque modificado: `dismissCleanupMap`, `getCloseOptionsForTarget`, `setTargetVisibility`, `installShowHideDismiss`, `installConfiguredShowHideDismiss`, caso `show_hide`, render de overlays/widgets y `onFlipChange`.
- Qué hacía antes: todo target abierto por `show_hide` usaba siempre el cierre heredado: botón flotante fijo, clic fuera, cierre al cambiar de página y `dismissAfter` si existía. El primer intento configurable solo leía `closeOptions` de `product_card`.
- Qué cambiaste: `show_hide` ahora lee `closeOptions` del elemento objetivo sin limitarse a Ficha de producto. Para widgets usa `obj.data.widget.config.closeOptions`; para objetos Fabric usa `obj.data.closeOptions`. Si no existen opciones, mantiene el cierre heredado. Con opciones personalizadas instala X interna para widgets DOM y X superpuesta en el overlay para objetos Fabric.
- Por qué: generalizar las Opciones de cierre a cualquier elemento objetivo de Mostrar/Ocultar, conservando compatibilidad total con documentos existentes.
- Riesgo posible: la X flotante de objetos Fabric se posiciona con el bounding box al momento de abrirse; acompaña la escala/página del overlay, pero no persigue animaciones posteriores del objeto si ocurren después de la apertura.
- Prueba realizada o pendiente: `node --check apps/viewer/src/flipbook.js` exitoso, sin salida; build/pruebas no ejecutadas por instrucción del usuario.

## 1.1. `apps/viewer/src/flipbook.js`

- Archivo tocado: `apps/viewer/src/flipbook.js`
- Función o bloque modificado: `installShowHideDismiss`, `installConfiguredShowHideDismiss`, caso `show_hide` y cierre en `onFlipChange`.
- Qué hacía antes: en cierre personalizado de objetos Fabric, el clic fuera no distinguía un clic sobre el propio canvas/objeto objetivo. La X flotante se posicionaba inline con un cálculo único. Las funciones de cierre limpiaban listener, timer y botón, pero no siempre eliminaban su entrada de `dismissCleanupMap` al cerrarse por X, clic fuera o timer.
- Qué cambiaste: agregué detección de clic sobre el objeto Fabric con `fcanvas.getPointer(event)` y `fabricTarget.containsPoint()`, con fallback de bounding box. Agregué `positionFloatingCloseButton()` para calcular la X con `setCoords()` y el bounding box actual. Envolví cada entrada activa para que `entry.hide()` limpie recursos y borre `dismissCleanupMap` solo si esa misma entrada sigue activa.
- Por qué: evitar que clics sobre imágenes, textos, formas, botones o SVG Fabric se interpreten como clic fuera; centralizar la posición de la X flotante; y prevenir que limpiezas antiguas borren aperturas nuevas del mismo elemento.
- Riesgo posible: la detección precisa depende de `containsPoint()` de Fabric; si no está disponible, el fallback usa bounding box axis-aligned, que es menos preciso en objetos rotados. No se agregó seguimiento continuo de animaciones por decisión de alcance.
- Prueba realizada o pendiente: revisión estática pendiente; build/pruebas no ejecutadas por instrucción del usuario.

## 1.2. `apps/viewer/src/flipbook.js`

- Archivo tocado: `apps/viewer/src/flipbook.js`
- Función o bloque modificado: `installShowHideDismiss` e `installConfiguredShowHideDismiss`.
- Qué hacía antes: el listener de clic fuera se registraba con `setTimeout(..., 160)` sin guardar el id del timeout. Si el elemento se cerraba antes de los 160 ms, la limpieza podía ocurrir antes de que el listener existiera y el timeout podía registrar después un listener obsoleto.
- Qué cambiaste: agregué `outsideDelay` en ambos flujos, guardé el timeout diferido y lo cancelo durante la limpieza si sigue pendiente. Cuando el timeout se ejecuta, restablece `outsideDelay` a `null` antes de registrar el listener.
- Por qué: evitar listeners de clic fuera tardíos después de cerrar un elemento y proteger aperturas nuevas del mismo target.
- Riesgo posible: bajo; conserva el delay de 160 ms, la lógica heredada, `dismissAfter`, el toggle y la detección de clic dentro de Fabric.
- Prueba realizada o pendiente: revisión estática pendiente; build/pruebas no ejecutadas por instrucción del usuario.

## 2. `apps/dashboard/src/pages/EditPublication.tsx`

- Archivo tocado: `apps/dashboard/src/pages/EditPublication.tsx`
- Función o bloque modificado: `PropsPanel` y `ProductCardWidgetProps`.
- Qué hacía antes: las Opciones de cierre estaban dentro del panel específico de Ficha de producto y guardaban `closeOptions` en `widget.config`; además incluían `closeBehavior` con la opción “Restaurar estado anterior”.
- Qué cambiaste: retiré las Opciones de cierre del panel de Ficha de producto y las moví al inspector general del elemento seleccionado. Agregué el interruptor “Usar opciones de cierre personalizadas al mostrar este elemento”. Mientras está apagado, no se guarda `closeOptions`; al activarlo, se crea en `obj.data.widget.config.closeOptions` para widgets o `obj.data.closeOptions` para objetos Fabric. Retiré `closeBehavior` y la opción “Restaurar estado anterior”.
- Por qué: hacer que la configuración pertenezca al elemento objetivo de Mostrar/Ocultar y mantener la función como opt-in real.
- Riesgo posible: no se ejecutó verificación TypeScript; la lógica usa actualización manual de `obj.data` para poder eliminar `closeOptions` cuando se apaga el modo personalizado.
- Prueba realizada o pendiente: revisión estática pendiente; build/pruebas no ejecutadas por instrucción del usuario.

## 3. `apps/dashboard/src/components/WidgetPreview.tsx`

- Archivo tocado: `apps/dashboard/src/components/WidgetPreview.tsx`
- Función o bloque modificado: rama `product_card` de `Body`.
- Qué hacía antes: el intento anterior mostraba una X visual específica para Ficha de producto cuando `closeOptions.showCloseButton` estaba activo.
- Qué cambiaste: retiré esa X específica y no agregué vista previa genérica de cierre en el editor.
- Por qué: las Opciones de cierre ahora son generales para Mostrar/Ocultar y la vista previa específica de Ficha de producto ya no corresponde al alcance aprobado.
- Riesgo posible: el editor no muestra una previsualización visual de la X personalizada; por ahora el panel de propiedades es la única interfaz, según decisión aprobada.
- Prueba realizada o pendiente: revisión estática pendiente; build/pruebas no ejecutadas por instrucción del usuario.

## 4. Validación autorizada

- Archivo tocado: `docs/bitacora/cierre-configurable-show-hide.md`
- Función o bloque modificado: registro de validación.
- Qué hacía antes: la bitácora indicaba build/pruebas pendientes.
- Qué cambiaste: registré la validación autorizada de compilación y sintaxis.
- Por qué: dejar constancia de los comandos ejecutados y sus resultados.
- Riesgo posible: el build reportó advertencias no bloqueantes de Vite sobre API CJS, recomendación de `@vitejs/plugin-react-oxc` y tamaño de chunk mayor a 500 kB.
- Prueba realizada o pendiente:
  - `npm run build --workspace=apps/dashboard`: exitoso. Ejecutó `tsc && vite build`; Vite construyó `dist/` correctamente con advertencias no bloqueantes.
  - `node --check apps/viewer/src/flipbook.js`: exitoso, sin salida.
  - `git diff --check`: exitoso, sin salida.

## 5. Corrección visual de cierre Mostrar/Ocultar

- Archivo tocado: `apps/viewer/src/flipbook.js`
- Función o bloque modificado: `installShowHideDismiss`, `installConfiguredShowHideDismiss` y helpers de X de cierre.
- Qué hacía antes: la ruta heredada agregaba a `document.body` un botón fijo “× Cerrar” fuera del flipbook, mientras la ruta configurable podía agregar otra X. Además, el flujo heredado registraba clic fuera por defecto con un retraso de 160 ms.
- Qué cambiaste: reemplacé el cierre fijo heredado por una X anclada al target mostrado. En widgets DOM la X queda dentro del elemento, en la esquina superior derecha. En imagen, texto, forma, SVG, botón u objeto Fabric la X se superpone en la esquina superior derecha del objeto dentro del área visual del flipbook.
- Por qué: la X debe ser el mecanismo universal y visible de cierre para cualquier elemento mostrado mediante Mostrar/Ocultar, sin duplicar controles fuera de la página.
- Clic fuera: pasó a ser opt-in; solo se registra cuando `closeOptions.closeOnOutsideClick === true`. Para documentos antiguos sin `closeOptions`, se conserva `dismissAfter` si existe y el cierre por cambio de página, pero ya no se aplica clic fuera automático.
- Nota sobre 160 ms: el valor se mantiene únicamente dentro del flujo de clic fuera activado y solo evita que el clic disparador cierre de inmediato el target recién abierto; no funciona como temporizador de cierre ni se cambió a segundos.
- Riesgo posible: la X de objetos Fabric se posiciona con el bounding box al abrirse, igual que la implementación previa de X superpuesta; no se agregó seguimiento continuo de animaciones posteriores.
- Prueba realizada o pendiente: revisión estática pendiente; build/pruebas no ejecutadas por instrucción del usuario.

## 6. Cierre estrictamente configurable

- Archivo tocado: `apps/viewer/src/flipbook.js`
- Función o bloque modificado: `installShowHideDismiss`, `installConfiguredShowHideDismiss`, `positionFloatingCloseButton`.
- Qué hacía antes: la corrección visual anterior montaba la X como mecanismo universal incluso sin `showCloseButton`, y la ruta heredada seguía registrando cierre por cambio de página.
- Qué cambiaste: cada mecanismo obedece estrictamente su opción en `closeOptions`: `showCloseButton === true` monta la X, `closeOnOutsideClick === true` registra clic fuera, `closeOnPageChange === true` cierra al cambiar página y `closeOnTimer === true` activa el temporizador. Si el target no tiene `closeOptions`, no se muestra X nueva, no se registra clic fuera y no se cierra por cambio de página; solo queda el toggle original y `dismissAfter` explícito en acciones antiguas.
- X Fabric: se mantiene superpuesta dentro del borde visual del objeto, en la esquina superior derecha interna con margen de 8 px, limitada al área de página para que no quede fuera ni lejos del elemento.
- Por qué: evitar cierres activos por defecto y hacer que la configuración guardada sea la única fuente de verdad para cada mecanismo.
- Prueba realizada o pendiente: `node --check apps/viewer/src/flipbook.js` exitoso, sin salida; build/pruebas no ejecutadas por instrucción del usuario.

## 7. Restricción de cambio de página en escritorio

- Archivo tocado: `apps/viewer/src/flipbook.js`
- Función o bloque modificado: `installDesktopEdgeFlipGuard`, detección de targets interactivos y marcado de hotspots/widgets/zonas de acción.
- Qué hacía antes: en escritorio el motor podía cambiar página con clics en cualquier punto de la página, incluyendo el centro.
- Qué cambiaste: en dispositivos con `matchMedia('(hover: hover) and (pointer: fine)')`, el inicio de PageFlip queda limitado a franjas laterales calculadas desde los `getBoundingClientRect()` de las hojas `.page` realmente visibles. Cada franja mide 6% del ancho de la hoja real, con mínimo 36 px y máximo 56 px.
- Modo doble o único: si hay dos hojas visibles separadas horizontalmente, solo se permite el borde exterior izquierdo de la hoja izquierda para volver y el borde exterior derecho de la hoja derecha para avanzar; la unión central queda bloqueada. Si hay una sola hoja visible, se usan sus bordes izquierdo/derecho según exista página previa/siguiente.
- Bloqueo nativo: el guard se instaló en captura sobre `#flipbook-container`, ancestro de `#flipbook`, y bloquea `pointerdown`, `pointermove`, `pointerup`, `mousedown`, `mousemove`, `mouseup` y `click` de secuencias iniciadas fuera de una franja válida. Ya no llama manualmente `pageFlip.flipPrev()` ni `pageFlip.flipNext()`; cuando el inicio cae en una franja válida, PageFlip recibe el gesto nativo.
- Prioridad interactiva: botones, enlaces, formularios, media embebida, controles, widgets DOM, hotspots y objetos con acción quedan marcados o detectados como interactivos, por lo que sus clics no pasan página aunque estén cerca del borde.
- Qué se preserva: móvil mantiene el comportamiento táctil/deslizamiento porque el guard solo corre con hover y puntero fino; no se tocaron flechas, teclado, cierre Mostrar/Ocultar, X, clic fuera, temporizador ni cierre por cambio de página configurado.
- Prueba realizada o pendiente: `node --check apps/viewer/src/flipbook.js` exitoso, sin salida; `git diff --check` exitoso, sin salida.

## 8. Límite visual del doblez en escritorio

- Archivo tocado: `apps/viewer/src/flipbook.js`
- Función o bloque modificado: cálculo de franjas en `getDesktopFlipEdgeZone` y limitación de movimiento en `installDesktopEdgeFlipGuard`.
- Qué cambiaste: separé la zona de activación de la zona visual. El gesto solo puede iniciar en el 8% del ancho real de la hoja, con mínimo 36 px y máximo 64 px, siempre en bordes exteriores válidos.
- Límite visual: durante un gesto válido, los movimientos que intentan llevar el doblez más allá del 15% del ancho real de la hoja se bloquean y se reenvían a PageFlip con coordenadas limitadas a ese borde visual. El `pointerup`/`mouseup` también se limita si hace falta para que PageFlip cierre o complete el gesto sin quedar atrapado.
- Qué se preserva: no se volvió a navegación manual con `flipPrev()`/`flipNext()`; PageFlip sigue recibiendo el gesto nativo solo desde franjas válidas. Móvil, táctil, controles, teclado, widgets, hotspots, acciones y cierres configurables no cambian.
- Prueba realizada o pendiente: `node --check apps/viewer/src/flipbook.js` exitoso, sin salida; `git diff --check` exitoso, sin salida.
