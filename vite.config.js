import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
   server: {
    port: 3000, // <-- aquí defines el puerto
    host: true  // útil si estás en WSL o contenedor para que escuche en 0.0.0.0
  }
})
