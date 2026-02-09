import axios, {type AxiosInstance} from "axios";

const api: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE ?? "",
  timeout: 15000,
  //withCredentials: true, // cookies de sesión
});

// Intercepta errores de conexion de API
api.interceptors.response.use(
  (r) => r,
  (err) => {
    console.error("API errors:", err?.response?.data || err.message);
    return Promise.reject(err);
  }
);

export default api;
