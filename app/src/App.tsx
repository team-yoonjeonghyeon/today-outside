import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ROUTES } from "./routes";
import Onboarding from "./screens/Onboarding";
import Home from "./screens/Home";
import LocationDenied from "./screens/LocationDenied";
import RegionSearch from "./screens/RegionSearch";
import Timeline from "./screens/Timeline";
import Details from "./screens/Details";
import RainDetail from "./screens/RainDetail";
import Settings from "./screens/Settings";
import DataSource from "./screens/DataSource";
import "./App.css";

function App() {
  return (
    <MemoryRouter initialEntries={[ROUTES.onboarding]}>
      <Routes>
        <Route path={ROUTES.onboarding} element={<Onboarding />} />
        <Route path={ROUTES.home} element={<Home />} />
        <Route path={ROUTES.locationDenied} element={<LocationDenied />} />
        <Route path={ROUTES.regionSearch} element={<RegionSearch />} />
        <Route path={ROUTES.timeline} element={<Timeline />} />
        <Route path={ROUTES.details} element={<Details />} />
        <Route path={ROUTES.rainDetail} element={<RainDetail />} />
        <Route path={ROUTES.settings} element={<Settings />} />
        <Route path={ROUTES.dataSource} element={<DataSource />} />
      </Routes>
    </MemoryRouter>
  );
}

export default App;
