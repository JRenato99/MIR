import { useNavigate, useParams } from "react-router-dom";
import RouteDetailGraph from "../components/RouteDetailGraph";

export default function RoutePage() {
  const { routeId } = useParams();
  const navigate = useNavigate();

  return (
    <div style={{ position: "relative", height: "100%" }}>
      <div style={{ position: "absolute", left: 12, top: 8, zIndex: 5 }}>
        <button className="btn" onClick={() => navigate("/overview")}>
          Volver
        </button>
      </div>
      <RouteDetailGraph route={{ id: routeId }} />
    </div>
  );
}
