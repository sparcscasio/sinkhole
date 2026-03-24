import { BrowserRouter, Routes, Route } from "react-router-dom";
import EscapeSRIPlannerPage from "./pages/EscapeSRIPlannerPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<EscapeSRIPlannerPage />} />
      </Routes>
    </BrowserRouter>
  );
}