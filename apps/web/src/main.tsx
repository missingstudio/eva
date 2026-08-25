import { RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { makeRouter } from "./routes.js"
import "./styles.css"

const page = document.getElementById("page")
if (page === null) throw new Error("index.html has no #page to mount into")

createRoot(page).render(
  <StrictMode>
    <RouterProvider router={makeRouter()} />
  </StrictMode>,
)
