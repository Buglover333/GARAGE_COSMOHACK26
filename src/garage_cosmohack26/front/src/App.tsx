import { useCallback, useEffect, useRef, useState } from 'react';
import { EarthScene, EarthSceneHandle } from './components/EarthScene';
import { Header } from './components/Header';
import { ConfigurationPanel } from './components/ConfigurationPanel';
import { NetworkStatusPanel } from './components/NetworkStatusPanel';
import { TimelineBar } from './components/TimelineBar';
import { ViewControlsOverlay } from './components/ViewControlsOverlay';
import { RouteInspectorModal } from './components/RouteInspectorModal';
import { SatelliteDetailPopup } from './components/SatelliteDetailPopup';
import { CreateProjectModal } from './components/CreateProjectModal';
import { ComparisonModal } from './components/ComparisonModal';
import { CommunicationRoute, ConstellationConfig, GroundStation, Satellite, SceneLayers, SimulationTime } from './types/simulation';
import { ConfigSummaryDto, ScenarioDto, simulationApi, toConfig, toRoutes, toSatellites, toStations } from './api/simulation';

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
  const [frameTimeSeconds, setFrameTimeSeconds] = useState(0);
  const [layers, setLayers] = useState<SceneLayers>({ showOrbits: true, showCoverageCones: false, showLabels: true });
  const [isRouteModalOpen, setIsRouteModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isComparisonModalOpen, setIsComparisonModalOpen] = useState(false);
  const [modalScenario, setModalScenario] = useState<ScenarioDto | null>(null);
  const [savedConfigs, setSavedConfigs] = useState<ConfigSummaryDto[]>([]);
  const [loadingConfigId, setLoadingConfigId] = useState<string | null>(null);
  const [disablingSatelliteId, setDisablingSatelliteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const earthSceneRef = useRef<EarthSceneHandle>(null);
  const scenarioRef = useRef<ScenarioDto | null>(null);
  const activeRouteIdRef = useRef<string | null>(null);
  const renderedStepRef = useRef<number | null>(null);
  const requestedSeekRef = useRef<number | null>(null);

  const refreshConfigLibrary = useCallback(async () => {
    const configs = await simulationApi.getConfigs();
    // The bundled example can also exist in the writable directory. Keep the
    // first item because that is the same precedence used by the backend loader.
    setSavedConfigs(configs.filter((item, index) => (
      configs.findIndex(candidate => candidate.id === item.id) === index
    )));
  }, []);

  useEffect(() => {
    void refreshConfigLibrary().catch(cause => (
      setError(cause instanceof Error ? cause.message : String(cause))
    ));
  }, [refreshConfigLibrary]);

  const refreshFrames = useCallback(async (force = false) => {
    const currentScenario = scenarioRef.current;
    if (!currentScenario) return;
    const [telemetry, routeFrame] = await Promise.all([
      simulationApi.getTelemetry(),
      simulationApi.getRoutes(),
    ]);
    const stepSeconds = telemetry.step_s;
    const stepIndex = Math.floor(telemetry.t_s / stepSeconds);
    if (!force && renderedStepRef.current === stepIndex) return;
    renderedStepRef.current = stepIndex;
    const nextRoutes = toRoutes(routeFrame);
    const active = nextRoutes.find(route => route.id === activeRouteIdRef.current)
      ?? nextRoutes.find(route => route.status !== 'offline')
      ?? nextRoutes[0]
      ?? null;
    activeRouteIdRef.current = active?.id ?? null;
    setActiveRouteId(active?.id ?? null);
    setRoutes(nextRoutes);
    setSatellites(toSatellites(telemetry, currentScenario, active));
    setFrameTimeSeconds(telemetry.t_s);
    setSimulationTime(previous => ({
      ...previous,
      timeSeconds: stepIndex * stepSeconds,
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
    const intervalMs = Math.max(
      250,
      (scenario.environment.step_s / simulationTime.speed) * 1000,
    );
    const timer = window.setInterval(() => {
      void refreshFrames().catch(cause => setError(cause instanceof Error ? cause.message : String(cause)));
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [scenario, simulationTime.speed, refreshFrames]);

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
    const currentScenario = scenarioRef.current;
    if (!currentScenario) return;
    const { step_s: step, horizon_s: horizon } = currentScenario.environment;
    const snappedSeconds = Math.min(
      horizon - step,
      Math.max(0, Math.round(seconds / step) * step),
    );
    if (requestedSeekRef.current === snappedSeconds) return;
    requestedSeekRef.current = snappedSeconds;
    try {
      await simulationApi.patchScenario({ seek_s: snappedSeconds });
      renderedStepRef.current = null;
      await refreshFrames(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      requestedSeekRef.current = null;
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
    await simulationApi.patchScenario({ playback: simulationTime.speed });
    const response = await simulationApi.getScenario();
    await applyScenario(response.scenario);
    renderedStepRef.current = null;
    await refreshFrames(true);
    await refreshConfigLibrary();
  }, [applyScenario, refreshConfigLibrary, refreshFrames, simulationTime.speed]);

  const loadProject = useCallback(async (id: string) => {
    setError(null);
    setLoadingConfigId(id);
    try {
      await simulationApi.loadScenario(id);
      await simulationApi.patchScenario({ playback: simulationTime.speed });
      const response = await simulationApi.getScenario();
      activeRouteIdRef.current = null;
      renderedStepRef.current = null;
      setSelectedSatellite(null);
      await applyScenario(response.scenario);
      await refreshFrames(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoadingConfigId(null);
    }
  }, [applyScenario, refreshFrames, simulationTime.speed]);

  const disableSatellite = useCallback(async (satelliteId: string) => {
    const currentScenario = scenarioRef.current;
    if (!currentScenario) return;

    const startSeconds = Math.min(frameTimeSeconds, currentScenario.environment.horizon_s - 1);
    const alreadyDisabled = currentScenario.failures.some(failure => (
      failure.satellite_id === satelliteId
      && typeof failure.start_s === 'number'
      && typeof failure.end_s === 'number'
      && failure.start_s <= startSeconds
      && startSeconds < failure.end_s
    ));
    if (alreadyDisabled) return;

    const failures = [
      ...currentScenario.failures,
      {
        satellite_id: satelliteId,
        start_s: startSeconds,
        end_s: currentScenario.environment.horizon_s,
        source: 'manual',
      },
    ];

    setError(null);
    setDisablingSatelliteId(satelliteId);
    try {
      await simulationApi.patchScenario({ failures });
      await applyScenario({ ...currentScenario, failures });
      renderedStepRef.current = null;
      await refreshFrames(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDisablingSatelliteId(null);
    }
  }, [applyScenario, frameTimeSeconds, refreshFrames]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#03060d] text-slate-100 font-sans">
      <EarthScene
        ref={earthSceneRef}
        config={config}
        frameTimeSeconds={frameTimeSeconds}
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
        savedConfigs={savedConfigs}
        simulationTime={simulationTime}
        loadingConfigId={loadingConfigId}
        onCreateProject={() => {
          setModalScenario(null);
          setIsCreateModalOpen(true);
        }}
        onLoadProject={id => void loadProject(id)}
        onOpenComparison={() => setIsComparisonModalOpen(true)}
        lang="ru"
      />
      <ConfigurationPanel
        config={config}
        satellites={satellites}
        simulationTime={simulationTime.timeSeconds}
        onFocusSatellite={focusSatellite}
        onEditConfig={() => {
          setModalScenario(scenario);
          setIsCreateModalOpen(true);
        }}
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
        onDisableSatellite={id => void disableSatellite(id)}
        isDisabling={selectedSatellite?.id === disablingSatelliteId}
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
        scenario={modalScenario}
        onClose={() => setIsCreateModalOpen(false)}
        onSave={createProject}
      />
      <ComparisonModal
        isOpen={isComparisonModalOpen}
        configs={savedConfigs}
        activeConfigId={config?.id ?? null}
        onClose={() => setIsComparisonModalOpen(false)}
      />
      {error && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 rounded-lg border border-rose-500/50 bg-rose-950/90 px-4 py-2 text-xs text-rose-200">
          Ошибка обновления: {error}
        </div>
      )}
    </div>
  );
}
