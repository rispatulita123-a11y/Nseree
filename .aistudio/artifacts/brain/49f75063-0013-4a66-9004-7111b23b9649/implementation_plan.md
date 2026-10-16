# Arquitectura Avanzada de IA de Competición: Rediseño Físico, Cinemático y Táctico para Apex GT

Diagnóstico exhaustivo y plan de ingeniería para solucionar las deficiencias de la Inteligencia Artificial en aceleración en rectas, cálculo de frenada en curvas, adelantamientos fluidos y disciplina de carril según las normas FIA en los tres circuitos oficiales.

> [!IMPORTANT] Parámetros y Decisiones Confirmadas con el Usuario
> - **Perfil de Agresividad y Dificultad**: Sistema adaptativo tripartito:
>   - *Novato*: Prudente, mayor margen de frenada (+15%), velocidad punta controlada, sin maniobras agresivas.
>   - *Competitivo (Medio)*: Ritmo estándar de carrera F1, apurada de frenada equilibrada, adelantamientos en rectas con rebufo.
>   - *Leyenda F1 (Difícil)*: Ultra-agresivo, aceleración al 100% hasta la tabla de 65m, frenada regresiva al vértice (trail braking), ataques decididos al interior y defensa de posición.
> - **Gestión Longitudinal (Rectas y Curvas)**:
>   - Acelerador plano al 100% (`throttle = 1.0`) en todas las zonas de aceleración y rectas hasta alcanzar la velocidad máxima real del monoplaza (330 - 355 km/h con DRS).
>   - Supresión del corte prematuro de aceleración y cálculo exacto del punto de frenada físico sin anticipación excesiva ni subviraje hacia el muro exterior.
> - **Espacio Rueda a Rueda (Regla Oficial FIA)**:
>   - Espacio mínimo garantizado de un ancho de monoplaza (2.2m - 2.5m de asfalto) en paralelo.
>   - Ceder el vértice si el atacante tiene el alerón delantero por delante del eje trasero del defensor a la entrada de la frenada.

---

## 1. Diagnóstico Exhaustivo: ¿Por Qué Ocurren los Problemas Actuales?

Tras la inspección profunda de `AICarController.ts`, `AIRaycastPerception.ts`, `VehiclePhysics.ts` y los waypoints de los circuitos (`CircuitWaypoints.ts`, `SpeedwayWaypoints.ts`, `SingaporeWaypoints.ts`), se identifican cuatro cuellos de botella fundamentales:

### Problema 1: Nunca van a fondo en las rectas
- **Causa A (Penalización doble en rectas por agarre de neumático)**:
  En `AICarController.ts` (línea 727), la velocidad máxima permitida se calcula multiplicando el límite del waypoint por el `gripFactor` del compuesto (`minAllowedSpeedMs = (baseWaypointLimit / 3.6) * diffSpeedScale * gripFactor...`).
  Con neumáticos medios, duros o con mínimo desgaste, el factor de agarre baja a `0.85 - 0.92`.
  En una recta de 345 km/h, la IA calcula un tope artificial de solo `290 - 305 km/h`. ¡La IA castigaba la velocidad punta en recta por la adherencia lateral en curva!
- **Causa B (Horizonte de frenada desmedido de 280 metros)**:
  El escaneo predictivo miraba `280 metros` hacia adelante (`maxScanDist = 280.0`).
  En el *Square Circuit*, la recta entera mide solo 184 metros.
  A mitad de recta (a 90m de la curva de 128 km/h), la fórmula `allowedSpeedMs = Math.sqrt(v_curva² + 2 * a * d)` ya limitaba la velocidad del coche a menos de `230 km/h`. La IA **nunca** podía desarrollar su aceleración máxima porque la curva siguiente la frenaba desde el inicio de la recta.
- **Causa C (Gobernador de acelerador defectuoso cerca del objetivo)**:
  En las líneas 833-840, si la velocidad estaba a menos de `0.5 m/s` (menos de 2 km/h) de la velocidad objetivo, el acelerador caía súbitamente al `20% - 55%`:
  ```typescript
  else if (mySpeed > targetSpeedMs - 0.5) {
    throttleInput = THREE.MathUtils.clamp((targetSpeedMs / (mySpeed + 0.1)) * 0.45, 0.20, 0.55);
  }
  ```
  Esto impedía que el coche mantuviera el acelerador a fondo (1.0), provocando que la IA rodara a medio gas en plena recta.
- **Causa D (Doble frenada en waypoints)**:
  Los waypoints del circuito cuadrado ya tenían pre-reducida la velocidad en el último 35% de la recta (línea 37: `lerp(345, 160)`), y sobre esa reducción la IA volvía a calcular otra frenada cinemática con el escáner de 280m. Frenaba dos veces consecutivas.

---

### Problema 2: En todas las curvas entran pasados y se chocan contra el exterior
- **Causa A (Colapso del ángulo de giro por el limitador de velocidad)**:
  Tanto en `AICarController.ts` como en `VehiclePhysics.ts` (línea 449), el ángulo máximo de dirección (`maxLock`) se reduce progresivamente con la velocidad mediante:
  `maxLock = lerp(0.52, 0.145, Math.pow(speedNorm, 0.65))`
  A 140 km/h (velocidad típica de entrada a curva), el giro máximo se reducía a solo `0.26 radianes` (~14.9°).
  Al intentar girar una curva de 90°, las ruedas físicas no podían angular lo suficiente para trazar el radio de giro, provocando subviraje terminal contra el muro exterior.
- **Causa B (Amortiguación negativa de velocidad angular y contravolante espurio)**:
  En la línea 821 de `AICarController.ts`:
  `rawSteeringDemand = (ppSteerAngle / maxLock) - (this.physics.angularVelocity * 0.08) + counterSteerCorrection;`
  Cuando el coche empezaba a rotar en la curva (`angularVelocity > 0`), el término `- (angularVelocity * 0.08)` **contrarrestaba el giro del volante**, obligando a la dirección a abrirse hacia el exterior justo en el momento más crítico. Si además se detectaba un mínimo deslizamiento trasero, el contravolante (`counterSteerCorrection`) giraba en sentido contrario, enviando el coche de frente al muro.
- **Causa C (Reducción prematura de freno por Trail Braking asimétrico)**:
  En la línea 844:
  `const trailMultiplier = 1.0 - (0.45 * this.trailBrakeAbility * steerLockRatio);`
  En cuanto la IA empezaba a mover el volante hacia el vértice, su potencia de frenado se cortaba hasta en un **45%**.
  Como el cálculo de distancia de frenada había asumido deceleración máxima lineal (sin saber que al girar se reduciría a la mitad), el coche se quedaba sin metros de frenada y se pasaba de largo.

---

### Problema 3: Otras veces frenan demasiado pronto
- Al aproximarse a una curva sin girar el volante (en línea recta), el escáner cinemático con `maxScanDist = 280m` calculaba la frenada con mucha antelación innecesaria.
- En rectas largas (Speedway y Singapur), la IA empezaba a levantar el pie 200 metros antes del cartel de 100m, perdiendo entre 2 y 3 segundos por vuelta frente a un piloto humano.

---

### Problema 4: No intentan adelantar y se chocan frecuentemente
- **Causa A (Ancho lateral seguro artificial de 2.2m en pistas de 16m)**:
  La IA limitaba su desviación lateral a `maxSafeLateral = 2.2m` en circuitos donde el asfalto permite entre 6m y 7.5m de anchura a cada lado de la línea ideal. Como el monoplaza mide 2.0m de ancho, con solo 2.2m de desplazamiento lateral quedaba a milímetros del coche rival.
- **Causa B (Conflicto entre la decisión de adelantar y el campo de repulsión APF)**:
  El radar evaluaba: *"Adelanta por la derecha a +2.2m"*, pero a continuación la función `computeRepulsionOffset` detectaba al rival a menos de 4.2m de distancia lateral/trasera y aplicaba una fuerza de repulsión inversa que devolvía a la IA a la estela del rival.
  Esto generaba una oscilación constante ("ping-pong") detrás del rival.
- **Causa C (Distancia de salida de rebufo tardía)**:
  La IA permanecía anclada exactamente detrás de la trasera del jugador (`targetLateralOffset = playerRelLateral`) hasta estar a solo `18 metros`. A 280 km/h (77 m/s), 18 metros se recorren en solo **0.23 segundos**. A la velocidad de cambio de carril (`lateralShiftSpeed = 4.5 m/s`), era físicamente imposible esquivar al coche delantero en 0.23 segundos, provocando choques por alcance constantes.

---

## 2. Nueva Arquitectura y Solución Técnica Propuesta

```
┌────────────────────────────────────────────────────────────────────────┐
│                   NUEVO PIPELINE DE PILOTAJE IA                        │
├────────────────────────────────────────────────────────────────────────┤
│ 1. Segmentación de Pista & Límite Físico de Recta                     │
│    - Detección de tramos rectos (curvatura < 0.008): 100% acelerador   │
│    - Supresión de penalización de neumático en velocidad punta recta   │
│    - DRS automático en zonas oficiales a fondo                        │
├────────────────────────────────────────────────────────────────────────┤
│ 2. Modelo Físico Exacto de Frenada y Deceleración Regresiva           │
│    - Cálculo dinámico de distancia de frenada real:                   │
│      d_freno = (v_actual² - v_vertice²) / (2 * a_freno_efectiva)       │
│    - Horizonte de escaneo adaptativo (máx. 110m, no 280m)             │
│    - Corrección de freno combinada con ángulo de dirección real       │
├────────────────────────────────────────────────────────────────────────┤
│ 3. Dirección Pura (Pure Pursuit) & Trazado de Vértices                │
│    - Radio de giro físico respetado: ángulo dinámico según radio curva │
│    - Eliminación de contravolantes erróneos en entrada de curva       │
│    - Lookahead tangencial al vértice interior (Apex clipping)          │
├────────────────────────────────────────────────────────────────────────┤
│ 4. Táctica de Rebufo & Adelantamiento con Regla FIA                   │
│    - Maniobra de cambio de carril anticipada (a 40m - 50m, no 18m)     │
│    - Aprovechamiento total del ancho de pista (+/- 4.8m en pista 16m) │
│    - Regla de 1 ancho de coche: si van en paralelo, carril reservado  │
└────────────────────────────────────────────────────────────────────────┘
```

### Cambios Concretos en los Algoritmos

#### A. Aceleración Plena en Rectas y Curva de Gas (Eliminación de medios gases)
- En rectas y salidas de curva donde la velocidad actual esté por debajo de la velocidad objetivo del tramo, el acelerador será **1.0 incondicional**.
- Se elimina la zona muerta que reducía el acelerador al 20%-55% cuando la velocidad se acercaba al objetivo.
- Se desacopla el `gripMultiplier` de neumáticos de la velocidad máxima en línea recta: en recta, la velocidad máxima solo depende de la potencia del motor, relación de cambio y resistencia aerodinámica (`drag`).

#### B. Frenada Física Tardía y Precisa
- Reducción del horizonte máximo de escaneo de `280 metros` a un valor dinámico dependiente de la velocidad actual:
  `maxScanDist = Math.min(125.0, (mySpeed * mySpeed) / (2 * 14.5) + 15.0)`
  (A 300 km/h son ~85m; a 150 km/h son ~35m). Esto permite que el monoplaza estire la frenada exactamente hasta el cartel de 65-75 metros como en la F1 real.
- Sustitución de la deceleración teórica inflada (`17.5 m/s²`) por el valor real medido del motor de físicas teniendo en cuenta el coeficiente de rozamiento de los neumáticos y la carga aerodinámica.

#### C. Control de Dirección y Paso por Curva Sin Subviraje
- Ajuste del limitador `maxLock` para permitir hasta `0.38 radianes` (~22°) a velocidades medias (100-160 km/h), garantizando que el monoplaza pueda inscribirse en curvas cerradas de 90° sin salirse hacia el exterior.
- Eliminación del término de amortiguación angular negativo que abría la dirección al rotar.
- Lookahead ajustado para apuntar al vértice interior de la curva, trazando la cuerda ideal "exterior-vértice-exterior".

#### D. Maniobras de Adelantamiento Tempranas y Regla FIA de Espacio
- Salida de la estela del coche delantero iniciada a `38 - 48 metros` de distancia relativa cuando la velocidad de aproximación sea positiva.
- Expansión de la banda lateral útil de `2.2m` a `4.2m` (aprovechando los 16m de pista sin tocar la hierba).
- Supresión del bucle de repulsión que forzaba a la IA a volver detrás del jugador.
- Lógica de paralelo FIA: cuando los coches ruedan lado a lado (`isSideBySide`), la IA mantiene estrictamente su carril (interior o exterior) respetando 2.5 metros de separación y no corta la trayectoria del rival.

#### E. Perfiles de Dificultad Adaptativos
- **Novato**: Margen de frenada seguro (+20% de distancia), aceleración 92%, velocidad en curva moderada, adelanta únicamente en rectas amplias con ventaja neta.
- **Medio (Competitivo)**: Margen de frenada estándar (+5%), aceleración 100%, velocidad punta completa en recta, busca el rebufo y se abre para adelantar.
- **Leyenda F1**: Margen de frenada al milímetro (0% margen de seguridad), aceleración 100% con DRS automático, trail braking agresivo, ataques al interior y defensa de línea en frenada.

---

## 3. Presupuesto de Rendimiento y Recursos (CPU, GPU, Memoria)

- **CPU (Hilo Principal)**:
  - Todas las operaciones trigonométricas y de cálculo de distancias se ejecutan en O(1) con índices locales pre-almacenados y vectores scratch reutilizables (`_vCamPos`, `MathPool`).
  - Cero llamadas a `new` o creación de objetos dentro del loop de físicas (0 bytes/frame de Garbage Collection).
  - Tasa de refresco del radar optimizada a 40 Hz desacoplada del tick de físicas de 120 Hz para mantener la fluidez máxima.
- **GPU / VRAM**:
  - Impacto nulo en GPU: los cambios son 100% algorítmicos en la CPU, sin aumento de draw calls, vértices o texturas.
- **Frametime**:
  - Menor a 0.25 ms por tick en CPU para la IA completa, garantizando 60 FPS estables en móviles y 120 FPS en monitores de alta tasa de refresco.

---

## 4. Plan de Implementación por Fases

### Fase 1: Calibración de Waypoints de Circuitos (`CircuitWaypoints.ts`, `SpeedwayWaypoints.ts`, `SingaporeWaypoints.ts`)
- Limpiar caídas de velocidad prematuras en tramos rectos de `CircuitWaypoints.ts`.
- Ajustar velocidades límite en los vértices de curva para coincidir con la física real de neumáticos.

### Fase 2: Rediseño del Algoritmo Longitudinal en `AICarController.ts`
- Implementar aceleración al 100% en rectas y tramos de gas sin cortes prematuros cerca del límite.
- Desacoplar el desgaste/tipo de neumático de la velocidad máxima en recta.
- Implementar el nuevo cálculo cinemático de distancia de frenada con horizonte dinámico.

### Fase 3: Rediseño del Algoritmo Lateral y Dirección en `AICarController.ts`
- Modificar el cálculo de `ppSteerAngle` y `maxLock` en curva para dotar al coche del giro suficiente para trazar el radio de 90° sin subviraje.
- Suprimir la interferencia de la velocidad angular y contravolante en entrada de curva.

### Fase 4: Sistema de Percepción Táctica y Adelantamiento en `AIRaycastPerception.ts`
- Ampliar la distancia de salida de rebufo a 45m.
- Expandir el ancho de maniobra lateral a +/- 4.2m.
- Aplicar la regla de respeto lateral FIA en paralelo.

### Fase 5: Perfiles de Dificultad Adaptativos
- Ajustar las variables de comportamiento según `easy`, `medium` y `hard`.

---

## 5. Plan de Verificación y Pruebas

1. **Prueba de Velocidad en Recta**:
   - Rodar en el Square Circuit, Speedway y Singapur con la IA en dificultad Media y Difícil.
   - Comprobar que en la recta principal la IA supera los `320+ km/h` en Square Circuit y `350+ km/h` en Speedway con DRS abierto.
2. **Prueba de Frenada y Curva**:
   - Observar el paso de la IA por la Curva 1 de los 3 circuitos: confirmar que no frena a 200m de distancia, que llega a la frenada fuerte a fondo y que traza la curva limpia sin subvirar contra el muro exterior.
3. **Prueba de Adelantamiento**:
   - Situar el coche del jugador a 200 km/h en medio de la recta principal.
   - Verificar que la IA aprovecha el rebufo, se abre con antelación a uno de los lados (a más de 40m) y supera al jugador sin tocar su parachoques trasero.
4. **Prueba Rueda a Rueda**:
   - Llegar en paralelo con la IA a la frenada de una curva.
   - Confirmar que la IA mantiene su carril dejando un ancho de monoplaza reglamentario sin embestir lateralmente al jugador.
5. **Verificación de Compilación y Rendimiento**:
   - Ejecutar `compile_applet` y `lint_applet` con 0 errores de tipos y comprobar estabilidad a 60/120 FPS.
