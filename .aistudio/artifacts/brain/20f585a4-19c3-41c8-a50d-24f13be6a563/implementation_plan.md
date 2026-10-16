# Implementation Plan - Circuit 2 Visibility and Outfield Rendering Fixes

## Problem Analysis
In Circuit 2 (Speedway GP / Autódromo), elements such as the Italian Alpine lake, the Riva marina, luxury VIP villas, and the Curvone promenade may experience visibility issues due to:
1. Camera far clipping plane (`camera.far = 1200` vs mountain ring at 580m radius / lake center at X=505, Z=95).
2. Atmospheric fog settings (`scene.fog` range 380 to 1250 meters obscuring distant outfield objects).
3. Shadow map range and object culling bounding spheres for large procedurally merged geometries (`AlpineLake_WaterSurface`, `ItalianVIPVillasComplex`).
4. Material transparency depth write settings (`depthWrite: true/false` or `renderOrder`) causing Z-fighting or transparency sorting issues with water surfaces and glass structures.

## Proposed Changes
1. **Camera & Frustum Capping**:
   - Increase camera `far` plane from 1200 to 2500 in `RacingGameEngine.ts` to ensure distant mountain backdrops and outfield lake complexes remain within the view frustum.
   - Adjust atmospheric fog near/far parameters (`scene.fog`) to gracefully blend distant scenery without premature culling.
2. **Geometry & Bounding Spheres**:
   - Ensure all merged outfield geometries (`AlpineLakeBasin`, `ItalianVIPVillasComplex`, `SpeedwayOutfield_AlpineResort`) have correct bounding spheres computed (`geometry.computeBoundingSphere()`, `geometry.boundingSphere.radius = Infinity` or explicitly expanded) so Three.js frustum culling does not incorrectly cull large outfield complexes when the car is looking from specific angles.
3. **Material & Transparency Refinement**:
   - Verify water surface, tinted glass, and semi-transparent shaders have appropriate `depthWrite` and `renderOrder` settings to prevent clipping or occlusion artifacts against terrain.

## Verification Plan
1. Compile applet (`compile_applet`) and run type checks (`lint_applet`).
2. Test Circuit 2 runtime execution in preview: verify visibility of the Italian Alpine lake, marina, villas, and panoramic promenade from start line, Curvone, and mega straight.
