# Pruebas manuales del laboratorio (E1)

Lista para comprobar en tu PC Linux que la base del laboratorio funciona de verdad. Marca cada casilla al hacerla y apunta lo que falle (paso, qué esperabas y qué viste). Lo automático ya lo cubre GitHub Actions (`emulator-e2e.yml`). Esto es lo que solo se ve usándolo.

Tiempo estimado: 45-60 minutos. Necesitas Docker Engine, unos 2 GB de RAM libres y unos 5 GB de disco.

---

## 0. Arranque

- [ ] **0.1** `git clone https://github.com/kryll/domoticaSimulator.git && cd domoticaSimulator`
- [ ] **0.2** `emulator/scripts/setup.sh`. Termina sin errores y al final muestra el **token del laboratorio**. La primera vez tarda varios minutos porque descarga las imágenes.
- [ ] **0.3** `docker ps` muestra 4 contenedores en marcha: `hasim-homeassistant`, `hasim-mosquitto`, `hasim-orchestrator` y `hasim-caddy`.
- [ ] **0.4** `docker logs hasim-mosquitto` no muestra avisos de permisos (`world readable`).
- [ ] **0.5** `ls -l emulator/.env emulator/.secrets/ha-token`: los dos son tuyos (no de root) y tienen permisos `-rw-------`.
- [ ] **0.6** `curl -s localhost:8081/health` responde con `ok: true`.

## 1. Home Assistant

- [ ] **1.1** Abre http://localhost:8123 y entra con `HA_USERNAME` / `HA_PASSWORD` de `emulator/.env`.
- [ ] **1.2** En Ajustes → Dispositivos y servicios aparece la integración **MQTT** configurada.
- [ ] **1.3** Todavía no hay dispositivos del simulador (aparecen al conectar la app).

## 2. Conectar la app con el laboratorio

- [ ] **2.1** Abre http://localhost:8080. Es la app servida por tu PC, no la de GitHub Pages. Elige «Explorar la demo».
- [ ] **2.2** Ajustes → Laboratorio → marca «Conectar con el laboratorio» **con un token incorrecto**. Debe decir que el token no es válido y no conectar.
- [ ] **2.3** Pega el token bueno (`LAB_TOKEN` de `emulator/.env`). El botón **Lab** de la barra pasa a «en vivo».
- [ ] **2.4** La velocidad queda fija en 1x, el reloj marca la hora real y «Ir a…» está desactivado.
- [ ] **2.5** Recarga la página: el laboratorio se vuelve a conectar sin pedir el token.

## 3. Dispositivos en HA

- [ ] **3.1** En HA → Dispositivos aparecen los de la demo, con su sala como área (Salón, Cocina, Dormitorio…).
- [ ] **3.2** Abre un dispositivo Zigbee (p. ej. «Puerta entrada»): cuelga de «Zigbee2MQTT Bridge (simulado)» y la versión de hardware dice «Radio: modelada, no real».
- [ ] **3.3** Las entidades tienen el mismo id que en el simulador: `light.luz_salon`, `switch.cafetera`, `lock.cerradura_entrada_lock`…
- [ ] **3.4** Sin duplicados: no hay entidades `_2` ni dispositivos repetidos.

## 4. Del simulador a HA

- [ ] **4.1** En la app, modo Uso (`U`), clic en «Luz salón»: en HA se enciende en uno o dos segundos.
- [ ] **4.2** Rueda sobre la luz para cambiar el brillo: HA muestra el mismo %.
- [ ] **4.3** Abre la puerta de entrada en la app: en HA el sensor pasa a «Abierta».
- [ ] **4.4** Mueve la persiana al 50 %: HA muestra la posición 50.
- [ ] **4.5** Cambia la temperatura de un sensor de clima: HA muestra el mismo valor.

## 5. De HA al simulador

- [ ] **5.1** Enciende «Luz salón» desde HA: en el plano de la app se enciende.
- [ ] **5.2** Cambia brillo y color desde HA: el nodo de la app los refleja.
- [ ] **5.3** Cierra la cerradura desde HA: la app la muestra cerrada.
- [ ] **5.4** Cambia la consigna del termostato desde HA: la app muestra «actual → consigna» con el valor nuevo.
- [ ] **5.5** Sin bucles: tras cada cambio, el estado se queda quieto (no parpadea ni se repite en el Registro).

## 6. Automatizaciones en el HA real

- [ ] **6.1** En HA → Automatizaciones aparecen las de la demo (vienen de `ha-config/packages/hasim/`).
- [ ] **6.2** Dispara una desde la app (p. ej. movimiento de noche): **es HA quien la ejecuta**. Se ve en la traza de HA, y la luz cambia en la app.
- [ ] **6.3** Crea o edita una automatización en la app: aparece en HA en unos segundos, tras la recarga.
- [ ] **6.4** Ajustes → Laboratorio → «Automatizaciones en el simulador»: desaparecen de HA y vuelven a ejecutarse en la app. Nunca en los dos sitios a la vez.
- [ ] **6.5** Vuelve a «en el HA del lab» y comprueba que reaparecen.

## 7. Nodos (arrancar y parar)

- [ ] **7.1** Panel Lab → Nodos → «Parar» un dispositivo: en HA pasa a «No disponible».
- [ ] **7.2** Mientras está parado, actúa sobre él desde HA: no cambia nada.
- [ ] **7.3** «Arrancar»: vuelve a estar disponible con su estado.
- [ ] **7.4** «Parar todo» y «Arrancar todo» funcionan.
- [ ] **7.5** Escenario «Falla el coordinador»: en HA caen solo los dispositivos Zigbee.
- [ ] **7.6** Escenario «Se cae Internet»: en HA caen los dispositivos de la nube (Termostato, Cafetera).

## 8. Pausa y desacople

- [ ] **8.1** Pulsa Pausa en vivo: pregunta «¿Parar todos los nodos?».
- [ ] **8.2** Al aceptar, HA ve todo «No disponible» y las automatizaciones vuelven al simulador.
- [ ] **8.3** «Volver a acoplar»: todo vuelve a estar disponible en HA.

## 9. Snapshots

- [ ] **9.1** Panel Lab → Snapshots → «Guardar» con un nombre: aparece en la lista.
- [ ] **9.2** `ls -l emulator/snapshots/` muestra permisos `drwx------`.
- [ ] **9.3** Sin `--docker`, «Restaurar» está desactivado y explica por qué.
- [ ] **9.4** `emulator/scripts/stop.sh && emulator/scripts/setup.sh --no-build --docker`, y vuelve a conectar la app.
- [ ] **9.5** Cambia algo en HA (p. ej. renombra un área) y en la app. Luego «Restaurar» el snapshot: HA se reinicia con la configuración guardada, y la app conserva las imágenes del plano y las variantes.
- [ ] **9.6** Guarda un snapshot con «Excluir credenciales» y restáuralo: sigues pudiendo entrar en HA con tu usuario.
- [ ] **9.7** Borra un snapshot: desaparece solo ese.

## 10. Resetear lab

- [ ] **10.1** Cambia varios estados y pulsa «Resetear lab»: en HA y en la app todo vuelve a los estados iniciales, sin entidades huérfanas.
- [ ] **10.2** Borra un dispositivo en la app: desaparece también de HA (no queda «No disponible» para siempre).

## 11. Inspector de tráfico

- [ ] **11.1** Panel Lab → Tráfico: al encender una luz aparecen el mensaje de HA (`…/set`, «entrada») y el estado de vuelta («salida»).
- [ ] **11.2** Filtros por dispositivo, sentido y topic (prueba `hasim-z2m/#`), pausa y «Exportar JSON».
- [ ] **11.3** El panel no tapa la barra de simulación y se puede plegar.

## 12. Seguridad

- [ ] **12.1** Desde otro equipo de tu red, http://IP-de-tu-PC:8080 **no responde** (por defecto solo escucha en local).
- [ ] **12.2** `curl -s localhost:8081/project` sin token da 401.
- [ ] **12.3** Abre una segunda pestaña con la app: el botón Lab dice «otra pestaña» y no controla el lab. Cierra la primera y la segunda toma el control.
- [ ] **12.4** Exporta el proyecto a JSON y busca `LAB_TOKEN`, `token` u `orchestratorUrl`: no aparecen.
- [ ] **12.5** Comparte el proyecto por enlace y ábrelo en otra ventana privada: no se conecta solo al laboratorio.
- [ ] **12.6** *(Opcional)* `LAB_BIND=0.0.0.0` en `.env` + `setup.sh --no-build`: desde otro equipo se abre la app, pero sin el token no se conecta al lab.

## 13. Parar, reiniciar y limpiar

- [ ] **13.1** `emulator/scripts/stop.sh`: se paran todos los contenedores. La app muestra el lab desconectado y sigue funcionando sola.
- [ ] **13.2** `emulator/scripts/setup.sh --no-build`: vuelve con todo como estaba (HA, dispositivos, automatizaciones).
- [ ] **13.3** Reinicia el PC: el laboratorio **no** arranca solo.
- [ ] **13.4** `emulator/scripts/reset.sh`: queda limpio. Con `--all` también borra `.env` y los snapshots.

---

## Límites conocidos de E1 (no son fallos)

- Z-Wave, Matter, Thread, ESPHome y Shelly llegan a HA por **MQTT genérico** («pendiente de E2/E3» en «Vía hacia HA»). En E2 y E3 llegarán por sus integraciones reales.
- `media_player` aparece en HA dividido en varias entidades (`…_state`, `…_power`, `…_volume`, `…_source`), porque MQTT no tiene esa plataforma.
- El laboratorio va en tiempo real: no se puede acelerar HA.
- Ninguna radio es real: la malla, la latencia y la pérdida se modelan en el motor.
- El perfil `matter` (opcional) deja el puerto 5580 abierto en todas las interfaces y sin autenticación. No lo actives fuera de una red de confianza.

## Si algo falla

Recoge esto y pásamelo:
- el número del paso y qué ocurrió;
- `docker compose -f emulator/docker-compose.yml logs --tail=200` (ojo: puede contener nombres de tus dispositivos, pero no las contraseñas);
- una captura de la app o de HA si es algo visual.
