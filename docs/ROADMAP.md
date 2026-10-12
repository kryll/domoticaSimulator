# Hoja de ruta

**Estado:** las tres fases están implementadas, revisadas y publicadas en `main`.

Resultado de la revisión de producto (recorrido real de la app en navegador). Las referencias `B#` y `C#` se usan en commits y en los informes de los agentes.

## Fase 1: interacción directa y coherencia

**A. Interacción directa en el lienzo**
- Modos del lienzo: «Edición» (seleccionar y arrastrar, botón rápido ⏻ en el nodo, Alt+clic = acción principal) y «Uso» (atajo `U`; clic = acción principal, nodos no arrastrables, Mayús+clic = seleccionar).
- En ambos modos: doble clic abre un popover de control junto al nodo; clic derecho abre un menú contextual (acciones rápidas, crear automatización con este dispositivo como disparador, añadir a escena, simular fallo, duplicar, conectar desde aquí, eliminar); rueda sobre el nodo ajusta brillo, posición, volumen o consigna (en Edición, con Mayús).
- Teclado: Espacio/Intro = acción principal, ↑/↓ = ±10 % o ±0,5 °C, 1-9 = 10-90 %, 0 = apagar. Globales: `V` seleccionar, `C` conectar, `R` dibujar sala, `U` uso, `P` simular/pausar.
- Estado visible por categoría: halo de luz según brillo y color, barra de persiana con porcentaje y movimiento, ondas y cuenta atrás en el movimiento, puerta abierta/cerrada, temperatura y humedad grandes, termostato «actual → consigna» con llama solo si `hvac_action=heating`, cerradura, cámara, altavoz o TV con volumen, aspiradora, mando con destello, infraestructura caída en gris.
- Motor: una sola vía de servicios para usuario y automatizaciones (`callService`); servicios ampliados (brillo en %, pasos, kelvin, RGB, persiana con recorrido y parada, modos y presets del termostato, volumen y fuente, aspiradora, ventilador, cerradura atascada); temporizadores internos (autoapagado del movimiento, recorrido de persiana, `for:`); capacidades por entidad en el catálogo.

**Mejoras y correcciones de la fase 1**
- B3: autoapagado del movimiento según el modelo y `for:` en disparadores y condiciones de estado.
- B5: integración por defecto según el contexto (ZHA/Z2M si hay coordinador, local antes que nube) y Autoconectar explica por qué no conecta.
- C2–C11 y C14 (ver informe): integración por defecto, controles que saltan servicios, campo de brillo confuso, servicios incompletos, termostato siempre activo, escenas con atributos de más y no editables, etiquetas de sala tapadas, iconos indistinguibles, el nodo solo muestra una entidad, nombres ambiguos, ejecutar una automatización a mano, aviso de esperas en pausa.

## Fase 2: validar el diseño
- B1: la simulación respeta la red (entidades `unavailable` si falta coordinador, hub, border router, HA o Internet).
- B2: escenarios de fallo con un clic (Internet, coordinador, corte de luz, HA reiniciando) e informe de qué deja de funcionar.
- B4: traza de cada ejecución de automatización y botones «Ejecutar acciones» / «Probar disparador».
- B6: selector de entidades con búsqueda y agrupado por sala; servicios filtrados por dominio; datos tipados.
- B7: plantillas de automatización tipo blueprint.
- B8: lista de materiales y presupuesto.
- B10: energía (potencia, kWh, coste) y baterías que se descargan.
- B12: día y noche reales por ubicación y fecha; saltar a una hora.
- C13: exportar YAML con la sintaxis actual de HA (`triggers:`/`actions:`).

## Fase 3: profundidad y entrega
- B9 personas y zonas; B11 más lógica (`not`, sol, `choose`/`if`, `wait_for_trigger`, `repeat`, `notify`); B13 modelo térmico por sala; B14 línea de tiempo con aserciones.
- B15 dashboard tipo Lovelace; B16 exportar `packages/` a HA real; B17 variantes del proyecto y comparación; B18 plantillas de casa; B19 grupos y áreas.
- B20 compartir por URL; B21 cobertura con paredes y mapa RSSI; B22 latencia y fiabilidad por protocolo; B23 historial y gráficas.
