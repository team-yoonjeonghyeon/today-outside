import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ROUTES } from "./routes";
import Onboarding from "./screens/Onboarding";
import Home from "./screens/Home";
import LocationDenied from "./screens/LocationDenied";
import RegionSearch from "./screens/RegionSearch";
import "./App.css";

function App() {
  return (
    <MemoryRouter initialEntries={[ROUTES.onboarding]}>
      <Routes>
        <Route path={ROUTES.onboarding} element={<Onboarding />} />
        <Route path={ROUTES.home} element={<Home />} />
        <Route path={ROUTES.locationDenied} element={<LocationDenied />} />
        <Route path={ROUTES.regionSearch} element={<RegionSearch />} />
      </Routes>
    </MemoryRouter>
  );
}

export default App;
