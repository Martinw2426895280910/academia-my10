# 🏆 Academia MY 10 — Todo por WhatsApp

App educativa con IA para Física, Química, Matemáticas, Biología y Ciencias de la Salud.  
Genera contenido formateado listo para enviar por WhatsApp.

---

## 📁 Estructura del proyecto

```
academia-my10/
├── public/
│   └── index.html        ← Frontend (portada + app)
├── api/
│   └── generate.js       ← Serverless function (Vercel)
├── vercel.json           ← Configuración de Vercel
└── README.md
```

---

## 🚀 Paso a paso: GitHub → Vercel

### 1. Subir a GitHub

```bash
# En la carpeta del proyecto:
git init
git add .
git commit -m "Academia MY 10 - primera versión"

# Crear repo en github.com y luego:
git remote add origin https://github.com/TU_USUARIO/academia-my10.git
git branch -M main
git push -u origin main
```

### 2. Desplegar en Vercel

1. Ve a **vercel.com** → Sign in con GitHub
2. Click **"Add New Project"**
3. Importa el repo `academia-my10`
4. En **"Environment Variables"** agrega:

   | Key | Value |
   |-----|-------|
   | `ANTHROPIC_API_KEY` | `sk-ant-...` (tu API key) |

5. Click **Deploy** ✅

---

## 🔑 Dónde obtener la API Key

1. Ve a **console.anthropic.com**
2. Settings → API Keys → Create Key
3. Copia la key y pégala en Vercel como variable de entorno

---

## ⚙️ Cómo funciona

```
Usuario → index.html → /api/generate → Anthropic API → Respuesta → WhatsApp
```

La API key **nunca queda expuesta** en el frontend.  
La Serverless Function de Vercel es quien llama a Anthropic de forma segura.

---

## 📱 Funcionalidades

- 5 materias: Física, Química, Matemáticas, Biología, Ciencias de la Salud
- 5 tipos de contenido: Completo, Resumen, Ejercicios, Fórmulas, Ejemplos
- Temas sugeridos por materia
- Contenido formateado para WhatsApp (emojis, secciones)
- Botón directo para abrir WhatsApp con el texto
- Botón copiar al portapapeles

---

## 🛠️ Desarrollo local

```bash
npm install -g vercel
vercel dev
# Crea un archivo .env.local con: ANTHROPIC_API_KEY=sk-ant-...
```

---

Hecho con ❤️ por Academia MY 10
