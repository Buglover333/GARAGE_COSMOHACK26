import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  Satellite,
  GroundStation,
  ConstellationConfig,
  SceneLayers,
  CommunicationRoute
} from '../types/simulation';
import {
  EARTH_RADIUS_SCENE,
  generateOrbitPlanes,
  latLonToVector3
} from '../utils/orbitalMechanics';
import {
  createStarfieldCanvas
} from '../utils/starfieldTexture';

export interface EarthSceneHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  focusStation: (stationId: string) => void;
  focusSatellite: (satId: string) => void;
}

interface EarthSceneProps {
  config: ConstellationConfig | null;
  frameTimeSeconds: number;
  satellites: Satellite[];
  groundStations: GroundStation[];
  activeRoute: CommunicationRoute | null;
  selectedStationId: string | null;
  selectedSatelliteId: string | null;
  onSelectStation: (station: GroundStation) => void;
  onSelectSatellite: (satellite: Satellite | null) => void;
  layers: SceneLayers;
}

export const EarthScene = forwardRef<EarthSceneHandle, EarthSceneProps>(({
  config,
  frameTimeSeconds,
  satellites,
  groundStations,
  activeRoute,
  selectedStationId,
  selectedSatelliteId,
  onSelectStation,
  onSelectSatellite,
  layers
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Three.js internal references
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  // Object group references
  const earthMeshRef = useRef<THREE.Mesh | null>(null);
  const orbitsGroupRef = useRef<THREE.Group | null>(null);
  const satellitesGroupRef = useRef<THREE.Group | null>(null);
  const stationsGroupRef = useRef<THREE.Group | null>(null);
  const routeGroupRef = useRef<THREE.Group | null>(null);
  const coverageGroupRef = useRef<THREE.Group | null>(null);
  const routePulseRef = useRef<THREE.Mesh | null>(null);
  const routePointsRef = useRef<THREE.Vector3[]>([]);
  const routePulsePhaseRef = useRef(0);
  const updateProjectedLabelsRef = useRef<() => void>(() => undefined);

  // Cached computed satellites
  const satellitesDataRef = useRef<Satellite[]>([]);

  // Projected 2D screen positions for labels
  const [projectedLabels, setProjectedLabels] = useState<Array<{
    id: string;
    text: string;
    x: number;
    y: number;
    visible: boolean;
    type: 'station' | 'gateway' | 'route-sat' | 'fault-sat' | 'client';
    subtext?: string;
  }>>([]);

  const [hoveredEntity, setHoveredEntity] = useState<string | null>(null);

  updateProjectedLabelsRef.current = () => {
    if (!cameraRef.current || !containerRef.current) return;

    const cam = cameraRef.current;
    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;
    const labelsList: typeof projectedLabels = [];

    cam.updateMatrixWorld();

    groundStations.forEach(station => {
      const [x, y, z] = latLonToVector3(
        station.lat,
        station.lon,
        EARTH_RADIUS_SCENE * 1.002,
      );
      const pos = new THREE.Vector3(x, y, z);
      const camDir = new THREE.Vector3().subVectors(cam.position, pos).normalize();
      const normal = pos.clone().normalize();
      const isFacing = normal.dot(camDir) > 0.12;

      pos.project(cam);
      if (pos.z < 1.0 && isFacing) {
        labelsList.push({
          id: station.id,
          text: station.name,
          x: ((pos.x + 1) * w) / 2,
          y: ((-pos.y + 1) * h) / 2,
          visible: true,
          type: station.type === 'gateway' ? 'gateway' : 'client',
          subtext: `${station.lat.toFixed(1)}°, ${station.lon.toFixed(1)}°`,
        });
      }
    });

    satellites.forEach(satellite => {
      if (
        satellite.status !== 'in_route'
        && satellite.status !== 'offline'
        && satellite.id !== selectedSatelliteId
      ) return;

      const pos = new THREE.Vector3(...satellite.position);
      const camDir = new THREE.Vector3().subVectors(cam.position, pos).normalize();
      const normal = pos.clone().normalize();
      const isFacing = normal.dot(camDir) > -0.1;

      pos.project(cam);
      if (pos.z < 1.0 && isFacing) {
        labelsList.push({
          id: satellite.id,
          text: satellite.id,
          x: ((pos.x + 1) * w) / 2,
          y: ((-pos.y + 1) * h) / 2,
          visible: true,
          type: satellite.status === 'offline' ? 'fault-sat' : 'route-sat',
          subtext: satellite.status === 'offline' ? 'Отказ' : 'В маршруте',
        });
      }
    });

    setProjectedLabels(labelsList);
  };

  // Initialize Three.js scene once
  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    // 1. Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // 2. Camera
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 1000);
    // Initial camera position matches the screenshot (viewing Northern Europe and Middle East from space)
    camera.position.set(0.5, 7.8, 9.8);
    cameraRef.current = camera;

    // 3. Renderer
    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    rendererRef.current = renderer;

    // 4. Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 6.2;
    controls.maxDistance = 28.0;
    controls.target.set(0, 0, 0);
    controls.maxPolarAngle = Math.PI * 0.95;
    controlsRef.current = controls;
    const handleCameraChange = () => updateProjectedLabelsRef.current();
    controls.addEventListener('change', handleCameraChange);

    // 5. Starfield background
    const starfieldCanvas = createStarfieldCanvas(2048, 1024);
    const starTexture = new THREE.CanvasTexture(starfieldCanvas);
    starTexture.colorSpace = THREE.SRGBColorSpace;
    const starGeo = new THREE.SphereGeometry(150, 32, 32);
    const starMat = new THREE.MeshBasicMaterial({
      map: starTexture,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const starMesh = new THREE.Mesh(starGeo, starMat);
    scene.add(starMesh);

    // 6. Earth model from the legacy frontend.
    const earthTexture = new THREE.TextureLoader().load(
      '/static/textures/earth-blue-marble.jpg'
    );
    earthTexture.colorSpace = THREE.SRGBColorSpace;
    earthTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const earthMaterial = new THREE.MeshBasicMaterial({
      map: earthTexture,
      toneMapped: false,
    });
    const earthGeo = new THREE.SphereGeometry(EARTH_RADIUS_SCENE, 96, 64);
    const earthMesh = new THREE.Mesh(earthGeo, earthMaterial);
    scene.add(earthMesh);
    earthMeshRef.current = earthMesh;

    const earthGrid = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_RADIUS_SCENE * 1.001, 36, 24),
      new THREE.MeshBasicMaterial({
        color: 0x223a52,
        wireframe: true,
        transparent: true,
        opacity: 0.18,
      })
    );
    scene.add(earthGrid);

    // Sun direction vector used by scene lighting.
    const sunDir = new THREE.Vector3(1.0, 0.25, 0.6).normalize();

    // 9. Groups
    const orbitsGroup = new THREE.Group();
    scene.add(orbitsGroup);
    orbitsGroupRef.current = orbitsGroup;

    const satellitesGroup = new THREE.Group();
    scene.add(satellitesGroup);
    satellitesGroupRef.current = satellitesGroup;

    const stationsGroup = new THREE.Group();
    scene.add(stationsGroup);
    stationsGroupRef.current = stationsGroup;

    const routeGroup = new THREE.Group();
    scene.add(routeGroup);
    routeGroupRef.current = routeGroup;

    const coverageGroup = new THREE.Group();
    scene.add(coverageGroup);
    coverageGroupRef.current = coverageGroup;

    // 10. Lighting
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.6);
    dirLight.position.copy(sunDir.clone().multiplyScalar(50));
    scene.add(dirLight);

    const ambientLight = new THREE.AmbientLight(0x1e293b, 0.4);
    scene.add(ambientLight);

    // Resize handler
    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
      updateProjectedLabelsRef.current();
    };
    window.addEventListener('resize', handleResize);

    // Animation Loop
    let animationFrameId: number;
    const timer = new THREE.Timer();
    timer.connect(document);

    const animate = (timestamp?: number) => {
      animationFrameId = requestAnimationFrame(animate);
      timer.update(timestamp);
      const delta = timer.getDelta();

      if (controlsRef.current) {
        controlsRef.current.update();
      }

      const routePoints = routePointsRef.current;
      const routePulse = routePulseRef.current;
      if (routePulse && routePoints.length >= 2) {
        routePulsePhaseRef.current = (routePulsePhaseRef.current + delta * 0.6) % 1;
        const routePosition = routePulsePhaseRef.current * (routePoints.length - 1);
        const fromIndex = Math.floor(routePosition);
        const toIndex = Math.min(fromIndex + 1, routePoints.length - 1);
        routePulse.position.copy(
          routePoints[fromIndex].clone().lerp(
            routePoints[toIndex],
            routePosition - fromIndex
          )
        );
      }

      // Render 3D scene
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      controls.removeEventListener('change', handleCameraChange);
      cancelAnimationFrame(animationFrameId);
      timer.dispose();
      if (rendererRef.current) {
        rendererRef.current.dispose();
      }
    };
  }, []);

  // Update Orbit Planes Geometry when config changes
  useEffect(() => {
    if (!orbitsGroupRef.current) return;
    const group = orbitsGroupRef.current;

    // Clear existing
    while (group.children.length > 0) {
      const obj = group.children[0];
      group.remove(obj);
      if (obj instanceof THREE.Line) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    }

    if (!layers.showOrbits || !config) return;

    const planes = generateOrbitPlanes(config, frameTimeSeconds, 128);
    const routeSatelliteIds = new Set(activeRoute?.satelliteHops ?? []);
    const routePlaneIndexes = new Set(
      satellites
        .filter(satellite => routeSatelliteIds.has(satellite.id))
        .map(satellite => satellite.planeIndex),
    );

    planes.forEach(plane => {
      const points = plane.points.map(p => new THREE.Vector3(p[0], p[1], p[2]));
      const geometry = new THREE.BufferGeometry().setFromPoints(points);

      const isRoutePlane = routePlaneIndexes.has(plane.planeIndex);

      const material = new THREE.LineBasicMaterial({
        color: isRoutePlane ? 0x0ea5e9 : 0x0284c7,
        transparent: true,
        opacity: isRoutePlane ? 0.75 : 0.35,
        linewidth: 1,
      });

      const line = new THREE.LineLoop(geometry, material);
      group.add(line);
    });
  }, [config, frameTimeSeconds, layers.showOrbits, satellites, activeRoute]);

  // Update Ground Stations Markers
  useEffect(() => {
    if (!stationsGroupRef.current) return;
    const group = stationsGroupRef.current;

    while (group.children.length > 0) {
      const obj = group.children[0];
      group.remove(obj);
    }

    groundStations.forEach(station => {
      const [x, y, z] = latLonToVector3(station.lat, station.lon, EARTH_RADIUS_SCENE * 1.002);
      const isSelected = station.id === selectedStationId;

      if (station.type === 'gateway') {
        // Gateway: Orange triangular beacon
        const geo = new THREE.ConeGeometry(0.18, 0.35, 3);
        geo.rotateX(Math.PI / 2); // Orient outward
        const mat = new THREE.MeshBasicMaterial({
          color: 0xf59e0b,
          wireframe: false,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y, z);
        mesh.lookAt(x * 2, y * 2, z * 2);
        mesh.userData = { type: 'station', id: station.id, data: station };
        group.add(mesh);

        // Pulsing base ring
        const ringGeo = new THREE.RingGeometry(0.2, 0.3, 16);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xf59e0b,
          transparent: true,
          opacity: 0.8,
          side: THREE.DoubleSide,
        });
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.position.set(x * 1.001, y * 1.001, z * 1.001);
        ringMesh.lookAt(x * 2, y * 2, z * 2);
        group.add(ringMesh);
      } else {
        // Client station marker.
        const color = isSelected ? 0x22c55e : 0x94a3b8;

        const sphereGeo = new THREE.SphereGeometry(isSelected ? 0.14 : 0.09, 16, 16);
        const sphereMat = new THREE.MeshBasicMaterial({ color });
        const marker = new THREE.Mesh(sphereGeo, sphereMat);
        marker.position.set(x, y, z);
        marker.userData = { type: 'station', id: station.id, data: station };
        group.add(marker);

        if (isSelected) {
          const radarRingGeo = new THREE.RingGeometry(0.18, 0.28, 24);
          const radarRingMat = new THREE.MeshBasicMaterial({
            color: 0x22c55e,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide,
          });
          const radarRing = new THREE.Mesh(radarRingGeo, radarRingMat);
          radarRing.position.set(x * 1.001, y * 1.001, z * 1.001);
          radarRing.lookAt(x * 2, y * 2, z * 2);
          group.add(radarRing);
        }
      }
    });
  }, [groundStations, selectedStationId]);

  // Update Satellites & Active Route Beams on simulation time or config changes
  useEffect(() => {
    if (!satellitesGroupRef.current || !routeGroupRef.current || !coverageGroupRef.current) return;

    const clientStation = groundStations.find(s => s.id === activeRoute?.clientStationId);
    const gatewayStation = groundStations.find(s => s.id === activeRoute?.gatewayStationId);
    const visiblePath = activeRoute && activeRoute.status !== 'offline'
      ? [activeRoute.clientStationId, ...activeRoute.satelliteHops, activeRoute.gatewayStationId]
      : [];
    const sats = satellites;
    satellitesDataRef.current = sats;

    // 2. Render Satellites Group
    const satGroup = satellitesGroupRef.current;
    while (satGroup.children.length > 0) {
      const obj = satGroup.children[0];
      satGroup.remove(obj);
    }

    sats.forEach(sat => {
      const [x, y, z] = sat.position;
      const isOffline = sat.status === 'offline';
      const isInRoute = sat.status === 'in_route';
      const isSelected = sat.id === selectedSatelliteId;

      // Color scheme matching screenshot
      let satColor = 0x38bdf8; // regular cyan-blue
      let satScale = 0.12;

      if (isOffline) {
        satColor = 0xef4444;
        satScale = 0.18;
      } else if (isInRoute) {
        satColor = 0x22d3ee; // Electric Cyan cross for SAT-12, SAT-18
        satScale = 0.22;
      } else if (isSelected) {
        satColor = 0xa855f7;
        satScale = 0.18;
      }

      const satMeshGroup = new THREE.Group();
      satMeshGroup.position.set(x, y, z);
      satMeshGroup.lookAt(0, 0, 0); // Orient toward Earth center

      // Central body bus
      const bodyGeo = new THREE.BoxGeometry(satScale * 0.8, satScale * 0.8, satScale * 0.8);
      const bodyMat = new THREE.MeshBasicMaterial({ color: satColor });
      const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
      satMeshGroup.add(bodyMesh);

      // Solar arrays (two extended rectangular wings)
      const wingGeo = new THREE.PlaneGeometry(satScale * 2.2, satScale * 0.7);
      const wingMat = new THREE.MeshBasicMaterial({
        color: isOffline ? 0x991b1b : 0x0284c7,
        side: THREE.DoubleSide,
      });
      const wingMesh = new THREE.Mesh(wingGeo, wingMat);
      satMeshGroup.add(wingMesh);

      // Reticle Cross marker for in-route satellites (as seen in screenshot: cyan diamond/cross with center dot)
      if (isInRoute) {
        const reticleGeo = new THREE.RingGeometry(satScale * 1.2, satScale * 1.6, 4); // Diamond ring
        const reticleMat = new THREE.MeshBasicMaterial({
          color: 0x22d3ee,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.9,
        });
        const reticleMesh = new THREE.Mesh(reticleGeo, reticleMat);
        reticleMesh.position.z = 0.05;
        satMeshGroup.add(reticleMesh);
      }

      // Alert beacon for an unavailable satellite.
      if (isOffline) {
        const alertRingGeo = new THREE.RingGeometry(satScale * 1.4, satScale * 1.9, 16);
        const alertRingMat = new THREE.MeshBasicMaterial({
          color: 0xef4444,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.85,
        });
        const alertMesh = new THREE.Mesh(alertRingGeo, alertRingMat);
        satMeshGroup.add(alertMesh);
      }

      satMeshGroup.userData = { type: 'satellite', id: sat.id, data: sat };
      satGroup.add(satMeshGroup);
    });

    // 3. Render the route returned by the backend.
    const routeGroup = routeGroupRef.current;
    while (routeGroup.children.length > 0) {
      const obj = routeGroup.children[0];
      routeGroup.remove(obj);
      if (obj instanceof THREE.Line || obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        materials.forEach(material => material.dispose());
      }
    }
    routePointsRef.current = [];
    routePulseRef.current = null;

    if (clientStation && gatewayStation && visiblePath.length >= 3) {
      const satMap = new Map<string, Satellite>(sats.map(s => [s.id, s]));
      const clientPos = latLonToVector3(clientStation.lat, clientStation.lon, EARTH_RADIUS_SCENE * 1.002);
      const gatewayPos = latLonToVector3(gatewayStation.lat, gatewayStation.lon, EARTH_RADIUS_SCENE * 1.002);
      const nodePosition = (id: string): [number, number, number] | null => {
        if (id === clientStation.id) return clientPos;
        if (id === gatewayStation.id) return gatewayPos;
        return satMap.get(id)?.position ?? null;
      };

      const routePoints = visiblePath
        .map(nodePosition)
        .filter((position): position is [number, number, number] => position !== null)
        .map(position => new THREE.Vector3(...position));

      if (routePoints.length === visiblePath.length) {
        routePointsRef.current = routePoints;

        const routeLine = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(routePoints),
          new THREE.LineBasicMaterial({
            color: 0xffd33d,
            linewidth: 2,
            transparent: true,
            opacity: 0.95,
          })
        );
        routeLine.frustumCulled = false;
        routeGroup.add(routeLine);

        const haloPoints = routePoints.map(point => point.clone().multiplyScalar(1.004));
        const routeHalo = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(haloPoints),
          new THREE.LineBasicMaterial({
            color: 0xffd33d,
            transparent: true,
            opacity: 0.25,
          })
        );
        routeHalo.frustumCulled = false;
        routeGroup.add(routeHalo);

        const endpointGeometry = new THREE.SphereGeometry(0.12, 12, 10);
        const endpointMaterial = new THREE.MeshBasicMaterial({ color: 0xffd33d });
        const startMarker = new THREE.Mesh(endpointGeometry, endpointMaterial);
        startMarker.position.copy(routePoints[0]);
        routeGroup.add(startMarker);
        const endMarker = new THREE.Mesh(endpointGeometry.clone(), endpointMaterial.clone());
        endMarker.position.copy(routePoints[routePoints.length - 1]);
        routeGroup.add(endMarker);

        const routePulse = new THREE.Mesh(
          new THREE.SphereGeometry(0.07, 12, 10),
          new THREE.MeshBasicMaterial({ color: 0xffffff })
        );
        routePulse.position.copy(routePoints[0]);
        routePulseRef.current = routePulse;
        routeGroup.add(routePulse);
      }
    }

    // 4. Render Coverage Cones if enabled
    const covGroup = coverageGroupRef.current;
    while (covGroup.children.length > 0) {
      const obj = covGroup.children[0];
      covGroup.remove(obj);
    }

    if (layers.showCoverageCones) {
      // Show coverage cones for in-route satellites or selected satellite
      const targetSats = sats.filter(s => s.status === 'in_route' || s.id === selectedSatelliteId);
      targetSats.forEach(sat => {
        const satPos = new THREE.Vector3(...sat.position);
        const satDist = satPos.length();
        const coneHeight = satDist - EARTH_RADIUS_SCENE;
        const coneRadius = Math.tan((25 * Math.PI) / 180) * coneHeight * 1.6;

        const coneGeo = new THREE.ConeGeometry(coneRadius, coneHeight, 32, 1, true);
        coneGeo.translate(0, -coneHeight / 2, 0);
        coneGeo.rotateX(-Math.PI / 2);

        const coneMat = new THREE.MeshBasicMaterial({
          color: sat.status === 'offline' ? 0xef4444 : 0x06b6d4,
          transparent: true,
          opacity: 0.12,
          side: THREE.DoubleSide,
          depthWrite: false,
        });

        const coneMesh = new THREE.Mesh(coneGeo, coneMat);
        coneMesh.position.copy(satPos);
        coneMesh.lookAt(0, 0, 0);
        covGroup.add(coneMesh);
      });
    }

  }, [satellites, groundStations, activeRoute, selectedSatelliteId, selectedStationId, layers.showCoverageCones]);

  useEffect(() => {
    updateProjectedLabelsRef.current();
  }, [satellites, groundStations, selectedSatelliteId, layers.showLabels]);

  // Raycasting for click and hover interactions
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !cameraRef.current || !sceneRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, cameraRef.current);

    // Check satellites first
    if (satellitesGroupRef.current) {
      const satHits = raycaster.intersectObjects(satellitesGroupRef.current.children, true);
      if (satHits.length > 0) {
        let parent = satHits[0].object;
        while (parent && !parent.userData?.id && parent.parent) {
          parent = parent.parent;
        }
        if (parent?.userData?.data) {
          onSelectSatellite(parent.userData.data);
          return;
        }
      }
    }

    // Check ground stations
    if (stationsGroupRef.current) {
      const stationHits = raycaster.intersectObjects(stationsGroupRef.current.children, true);
      if (stationHits.length > 0) {
        const hit = stationHits[0].object;
        if (hit.userData?.data) {
          onSelectStation(hit.userData.data);
          return;
        }
      }
    }
  };

  // Expose imperative camera controls
  useImperativeHandle(ref, () => ({
    zoomIn: () => {
      if (!cameraRef.current || !controlsRef.current) return;
      cameraRef.current.position.multiplyScalar(0.85);
      controlsRef.current.update();
    },
    zoomOut: () => {
      if (!cameraRef.current || !controlsRef.current) return;
      cameraRef.current.position.multiplyScalar(1.15);
      controlsRef.current.update();
    },
    focusStation: (stationId: string) => {
      const st = groundStations.find(s => s.id === stationId);
      if (!st || !cameraRef.current || !controlsRef.current) return;
      const [x, y, z] = latLonToVector3(st.lat, st.lon, 11.0);
      cameraRef.current.position.set(x, y, z);
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
    },
    focusSatellite: (satId: string) => {
      const sat = satellitesDataRef.current.find(s => s.id === satId);
      if (!sat || !cameraRef.current || !controlsRef.current) return;
      const [x, y, z] = sat.position;
      cameraRef.current.position.set(x * 1.6, y * 1.6, z * 1.6);
      controlsRef.current.target.set(x * 0.5, y * 0.5, z * 0.5);
      controlsRef.current.update();
    }
  }));

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden bg-[#03060d]">
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        className="w-full h-full cursor-grab active:cursor-grabbing block"
      />

      {/* Floating 2D Screen Overlay Labels matching the screenshot */}
      {layers.showLabels && projectedLabels.map(label => {
        if (!label.visible) return null;

        let badgeStyle = 'bg-slate-900/85 text-white border-slate-700/80';
        let dotColor = 'bg-slate-400';

        if (label.type === 'client') {
          // Client station.
          badgeStyle = 'bg-emerald-950/90 text-emerald-300 border-emerald-500/60 shadow-lg shadow-emerald-900/40';
          dotColor = 'bg-emerald-400 animate-pulse';
        } else if (label.type === 'gateway') {
          // Gateway: orange prominent beacon
          badgeStyle = 'bg-amber-950/90 text-amber-300 border-amber-500/60 shadow-lg shadow-amber-900/40';
          dotColor = 'bg-amber-400';
        } else if (label.type === 'route-sat') {
          // Satellite in the selected route.
          badgeStyle = 'bg-cyan-950/90 text-cyan-300 border-cyan-500/60 shadow-lg shadow-cyan-900/40';
          dotColor = 'bg-cyan-400';
        } else if (label.type === 'fault-sat') {
          // Unavailable satellite.
          badgeStyle = 'bg-rose-950/90 text-rose-300 border-rose-500/60 shadow-lg shadow-rose-900/40 animate-pulse';
          dotColor = 'bg-rose-500';
        }

        return (
          <div
            key={label.id}
            style={{
              transform: `translate(${label.x}px, ${label.y}px) translate(-50%, -120%)`,
            }}
            className="absolute top-0 left-0 pointer-events-none select-none z-10"
          >
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border backdrop-blur-md text-xs font-tech font-semibold tracking-wide ${badgeStyle}`}>
              <span className={`w-2 h-2 rounded-full ${dotColor}`} />
              <span>{label.text}</span>
            </div>
            {/* Small pointer tick */}
            <div className="w-1.5 h-1.5 bg-slate-800 rotate-45 mx-auto -mt-1 border-r border-b border-slate-600" />
          </div>
        );
      })}
    </div>
  );
});

EarthScene.displayName = 'EarthScene';
