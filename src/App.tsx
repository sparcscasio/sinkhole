import { BrowserRouter, Routes, Route } from "react-router-dom";
import EscapeSRIPlannerPage from "./pages/EscapeSRIPlannerPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/sinkhole" element={<EscapeSRIPlannerPage />} />
      </Routes>
    </BrowserRouter>
  );
}