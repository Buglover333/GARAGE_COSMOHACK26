import { useCallback, useEffect, useRef, useState } from 'react';
import { EarthScene, EarthSceneHandle } from './components/EarthScene';
import { Header } from './components/Header';
import { ConfigurationPanel } from './components/ConfigurationPanel';
import { NetworkStatusPanel } from './components/NetworkStatusPanel';
import { TimelineBar } from './components/TimelineBar';
import { LegendOverlay } from './components/LegendOverlay';
import { ViewControlsOverlay } from './components/ViewControlsOverlay';
import { RouteInspectorModal } from './components/RouteInspectorModal';
import { SatelliteDetailPopup } from './components/SatelliteDetailPopup';
import { CreateProjectModal } from './components/CreateProjectModal';
import { CommunicationRoute, ConstellationConfig, GroundStation, Satellite, SceneLayers, SimulationTime } from './types/simulation';
import { ScenarioDto, simulationApi, toConfig, toRoutes, toSatellites, toStations } from './api/simulation';

export default function App() {
  const [config, setConfig] = useState<ConstellationConfig | null>(null);
  const [scenario, setScenario] = useState<ScenarioDto | null>(null);
  const [stations, setStations] = useState<GroundStation[]>([]);
  const [satellites, setSatellites] = useState<Satellite[]>([]);
  const [routes, setRoutes] = useState<CommunicationRoute[]>([]);
  const [activeRouteId, setActiveRouteId] = useState<string | null>(null);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [selectedSatellite, setSelectedSatellite] = useState<Satellite | null>(null);
  const [simulationTime, setSimulationTime] = useState<SimulationTime>({
    timeSeconds: 0,
    isPlaying: true,
    speed: 10,
    horizonSeconds: 86400,
  });
  const [layers, setLayers] = useState<SceneLayers>({ showOrbits: true, showCoverageCones: false, showLabels: true });
  const [isRouteModalOpen, setIsRouteModalOpen] = useState(false);
  const [createMode, setCreateMode] = useState<'manual' | 'file'>('manual');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const earthSceneRef = useRef<EarthSceneHandle>(null);
  const scenarioRef = useRef<ScenarioDto | null>(null);
  const activeRouteIdRef = useRef<string | null>(null);

  const refreshFrames = useCallback(async () => {
    const currentScenario = scenarioRef.current;
    if (!currentScenario) return;
    const [telemetry, routeFrame] = await Promise.all([
      simulationApi.getTelemetry(),
      simulationApi.getRoutes(),
    ]);
    const nextRoutes = toRoutes(routeFrame);
    const active = nextRoutes.find(route => route.id === activeRouteIdRef.current)
      ?? nextRoutes.find(route => route.status !== 'offline')
      ?? nextRoutes[0]
      ?? null;
    activeRouteIdRef.current = active?.id ?? null;
    setActiveRouteId(active?.id ?? null);
    setRoutes(nextRoutes);
    setSatellites(toSatellites(telemetry, currentScenario, active));
    setSimulationTime(previous => ({
      ...previous,
      timeSeconds: telemetry.t_s,
      horizonSeconds: telemetry.horizon_s,
    }));
  }, []);

  const applyScenario = useCallback(async (nextScenario: ScenarioDto) => {
    scenarioRef.current = nextScenario;
    setScenario(nextScenario);
    setConfig(toConfig(nextScenario));
    const nextStations = toStations(nextScenario);
    setStations(nextStations);
    setSelectedStationId(previous => nextStations.some(station => station.id === previous)
      ? previous
      : (nextStations.find(station => station.type === 'client') ?? nextStations[0])?.id ?? null);
  }, []);

  useEffect(() => {
    if (!scenario) return;
    const timer = window.setInterval(() => {
      void refreshFrames().catch(cause => setError(cause instanceof Error ? cause.message : String(cause)));
    }, 500);
    return () => window.clearInterval(timer);
  }, [scenario, refreshFrames]);

  useEffect(() => {
    if (!selectedSatellite) return;
    const current = satellites.find(satellite => satellite.id === selectedSatellite.id);
    if (current) setSelectedSatellite(current);
  }, [satellites, selectedSatellite?.id]);

  const activeRoute = routes.find(route => route.id === activeRouteId) ?? null;
  const selectedStation = stations.find(station => station.id === selectedStationId) ?? null;

  const selectStation = useCallback((station: GroundStation) => {
    setSelectedStationId(station.id);
    const matchingRoute = routes.find(route =>
      station.type === 'client'
        ? route.clientStationId === station.id
        : route.gatewayStationId === station.id
    );
    if (matchingRoute) {
      activeRouteIdRef.current = matchingRoute.id;
      setActiveRouteId(matchingRoute.id);
    }
    earthSceneRef.current?.focusStation(station.id);
  }, [routes]);

  const focusSatellite = useCallback((id: string) => {
    const satellite = satellites.find(item => item.id === id);
    if (satellite) {
      setSelectedSatellite(satellite);
      earthSceneRef.current?.focusSatellite(id);
    }
  }, [satellites]);

  const seek = useCallback(async (seconds: number) => {
    try {
      await simulationApi.patchScenario({ seek_s: seconds });
      await refreshFrames();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [refreshFrames]);

  const changeSpeed = useCallback(async (speed: SimulationTime['speed']) => {
    setSimulationTime(previous => ({ ...previous, speed }));
    try {
      await simulationApi.patchScenario({ playback: speed });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const createProject = useCallback(async (newScenario: ScenarioDto) => {
    setError(null);
    await simulationApi.replaceScenario(newScenario);
    await simulationApi.saveScenario(newScenario.meta.id, newScenario.meta.title);
    const response = await simulationApi.getScenario();
    await applyScenario(response.scenario);
    await refreshFrames();
  }, [applyScenario, refreshFrames]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#03060d] text-slate-100 font-sans">
      <EarthScene
        ref={earthSceneRef}
        config={config}
        satellites={satellites}
        groundStations={stations}
        activeRoute={activeRoute}
        selectedStationId={selectedStationId}
        selectedSatelliteId={selectedSatellite?.id ?? null}
        onSelectStation={selectStation}
        onSelectSatellite={setSelectedSatellite}
        layers={layers}
      />
      <Header
        config={config}
        simulationTime={simulationTime}
        onCreateProject={mode => {
          setCreateMode(mode);
          setIsCreateModalOpen(true);
        }}
        lang="ru"
      />
      <ConfigurationPanel
        config={config}
        satellites={satellites}
        simulationTime={simulationTime.timeSeconds}
        onFocusSatellite={focusSatellite}
        lang="ru"
      />
      <NetworkStatusPanel
          selectedStation={selectedStation}
          stations={stations}
          onSelectStation={selectStation}
          activeRoute={activeRoute}
          satellites={satellites}
          onOpenRouteModal={() => setIsRouteModalOpen(true)}
          onFocusSatellite={focusSatellite}
          lang="ru"
        />
      <LegendOverlay lang="ru" />
      <ViewControlsOverlay
        layers={layers}
        onToggleLayer={key => setLayers(previous => ({ ...previous, [key]: !previous[key] }))}
        onZoomIn={() => earthSceneRef.current?.zoomIn()}
        onZoomOut={() => earthSceneRef.current?.zoomOut()}
        lang="ru"
      />
      {config ? <TimelineBar
        simulationTime={simulationTime}
        onSeek={seconds => void seek(seconds)}
        onSpeedChange={speed => void changeSpeed(speed)}
        events={[]}
        lang="ru"
      /> : <div className="absolute bottom-4 left-6 right-6 z-20 h-16 rounded-2xl bg-slate-950/90 border border-slate-800/90 flex items-center justify-center text-xs text-slate-500">Данные временной шкалы появятся после создания проекта</div>}
      <SatelliteDetailPopup
        satellite={selectedSatellite}
        onClose={() => setSelectedSatellite(null)}
        onFocusSatellite={focusSatellite}
        lang="ru"
      />
      <RouteInspectorModal
        isOpen={isRouteModalOpen}
        onClose={() => setIsRouteModalOpen(false)}
        routes={routes}
        activeRouteId={activeRouteId ?? ''}
        onSelectRoute={route => {
          activeRouteIdRef.current = route.id;
          setActiveRouteId(route.id);
          setIsRouteModalOpen(false);
        }}
        lang="ru"
      />
      <CreateProjectModal
        isOpen={isCreateModalOpen}
        initialMode={createMode}
        onClose={() => setIsCreateModalOpen(false)}
        onCreate={createProject}
      />
      {error && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 rounded-lg border border-rose-500/50 bg-rose-950/90 px-4 py-2 text-xs text-rose-200">
          Ошибка обновления: {error}
        </div>
      )}
    </div>
  );
}
