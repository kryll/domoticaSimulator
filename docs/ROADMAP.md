# Hoja de ruta

**Estado:** las fases 1-3, las tandas 1-3 y la base del laboratorio (E1) están publicadas en `main`, revisadas y con la prueba de extremo a extremo con Home Assistant real superada en GitHub Actions. E2 (Z-Wave JS con el mock de zwave-js y ESPHome con la API nativa emulada, perfiles `zwave` y `esphome`) también está publicado y con la prueba de extremo a extremo superada en GitHub Actions (`emulator-e2e.yml`, perfiles `zwave,esphome`); las pruebas manuales están en `docs/PRUEBAS_E2.md`. E3, en curso: Matter hecho (perfil `matter`: bridge de matter.js comisionado solo en matterjs-server 1.4.0, probado en local contra HA 2026.10; pendiente de pasar `emulator-e2e.yml` con `perfiles: zwave,esphome,matter`; pruebas manuales en `docs/PRUEBAS_E3.md`); falta Shelly.

## Visión (octubre 2026): laboratorio domótico tipo GNS3

El producto se reorienta: es un **laboratorio en casa para hacer pruebas, nunca un entorno real**. Igual que GNS3 ejecuta software de red real sobre una topología virtual, aquí corre un Home Assistant real, con su panel, y software real (Z-Wave JS, servidor Matter) o protocolos exactos (Zigbee2MQTT, API nativa de ESPHome) conectados a dispositivos emulados que se dibujan en el plano, se arrancan, se paran, se rompen y se restauran.

| GNS3 | Laboratorio domótico |
|---|---|
| Servidor GNS3 | Orquestador `emulator/` en un PC Linux con Docker |
| Cliente gráfico | La app: plano, dispositivos y enlaces |
| Imágenes reales | HA, Z-Wave JS (Z-Wave JS UI con el driver real), Matter; Z2M y ESPHome con su protocolo exacto (formato de Z2M, API nativa de ESPHome) |
| Apagar un nodo o tirar un cable | Arrancar o parar un dispositivo; fallos inyectados con Docker |
| Snapshots | Snapshots del proyecto y de la configuración de HA |
| Wireshark | Inspector de tráfico (MQTT, Z-Wave, Matter) |

**Prioridades a partir de ahora:**
1. **E1, base del laboratorio:** orquestador, HA real, MQTT al estilo de Zigbee2MQTT, ciclo de vida de los dispositivos, resetear el lab, snapshots e inspector de tráfico.
2. **E2:** Z-Wave con el mock de zwave-js + Z-Wave JS UI (integración `zwave_js`) y ESPHome con la API nativa emulada (integración `esphome`; se descartó compilar la plataforma `host`).
3. **E3:** Matter con matter.js (hecho, perfil `matter`) y emulador Shelly.
4. **E4:** inyección de fallos real (red, coordinador, Internet, latencia con `tc netem`).
5. **E5:** el mundo físico alimenta el laboratorio: día típico, personas, clima y consumo, que generan la vida de la casa a la que reacciona el HA real.

**Pierde peso:** el motor de automatizaciones propio (editor, trazas, escenas). Sigue como «modo rápido» sin Docker, pero en el laboratorio las automatizaciones corren en el HA real. Tampoco se invierte más en PWA, en el diseño para móvil ni en helpers propios, porque los aporta HA.

**Límites honestos:** Zigbee no tiene coordinador emulable (se imita con el formato exacto de Z2M y sin radio real); Thread solo de forma experimental con OpenThread; el laboratorio va en tiempo real, como GNS3.

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

## Siguientes tandas (revisión de uso, octubre 2026)

Resultado de recorrer la app como novato, instalador y usuario avanzado de HA, en escritorio, tableta y móvil. El rendimiento no es un problema: con 150 dispositivos en 3 plantas, la carga tarda unos 340 ms, la simulación a 600x va a unos 60 fps y la memoria ronda los 20 MB.

**Tanda 1: confianza y datos**
- Sincronización entre pestañas, guardado al cerrar u ocultar la pestaña y aviso si falla el guardado.
- Copias automáticas e historial de versiones del proyecto.
- YAML sin pérdida de datos: aviso de claves ignoradas, varias entidades y `area_id` por acción, `id` del disparador y condición `trigger`.
- Selección múltiple real con copiar, pegar y duplicar y acciones en lote. Diálogo de confirmación propio con Deshacer.

**Tanda 2: primera experiencia y entrega**
- Estado vacío guiado y tour; arreglos rápidos desde la validación; colocación inteligente al añadir dispositivos.
- Selector de estados traducido en disparadores y condiciones; editor de automatizaciones a pantalla completa.
- Modo presentación de solo lectura para el cliente; informe PDF con presupuesto por partidas (mano de obra, margen, IVA).
- Pasada de textos (plurales, estados traducidos, sin códigos internos) y de accesibilidad (contraste, menús, enlaces de salto).

**Tanda 3: paridad con HA y alcance**
- Helpers (`input_*`, `timer`, `counter`), `time_pattern`, arranque de HA, día de la semana, `stop` y `parallel`.
- Importar desde un HA real (`automations.yaml`, `scenes.yaml`, `core.device_registry`, `core.area_registry`).
- Dispositivos personalizados y catálogo ampliado (humo y CO, alarma, aire acondicionado, energía, válvula, garaje, ESPHome).
- Generador de «día típico», búsqueda global (Ctrl+K), diseño responsive y táctil, y PWA.

**Robots aspiradores y asistentes de voz (octubre 2026)**
- Catálogo: robots de Roborock, Dreame (HACS), iRobot, Eufy (HACS), Ecovacs y Xiaomi; asistentes Amazon Echo (Dot, Pop, 4.ª, Studio, Show 5/8/15, Hub), Google Nest (Mini, Audio, Hub, Hub Max), Apple HomePod, Sonos Era 300, HA Voice PE, ESP32-S3-BOX-3 y satélite Wyoming.
- Dominio `vacuum` completo (salas y segmentos, batería, consumibles, base de autovaciado, errores, energía) con el robot moviéndose por el plano; `assist_satellite` con intérprete de intenciones, exposición a Assist, Alexa y Google, disparador `conversation` y dependencia de Internet de Alexa y Google.
- Laboratorio: `vacuum` por MQTT; satélites y altavoces como sensor + `notify`. Con el perfil `esphome`, los satélites ESPHome llegan por la integración ESPHome (estado + texto de anuncio; sin micrófono no hay `assist_satellite`). Wyoming real, candidato.
