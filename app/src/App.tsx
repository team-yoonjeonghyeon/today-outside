import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ROUTES } from "./routes";
import Onboarding from "./screens/Onboarding";
import Home from "./screens/Home";
import LocationDenied from "./screens/LocationDenied";
import RegionSearch from "./screens/RegionSearch";
import Timeline from "./screens/Timeline";
import Details from "./screens/Details";
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
      </Routes>
    </MemoryRouter>
  );
}

export default App;
