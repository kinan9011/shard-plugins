import { mountTool } from "./bootstrap";
import { MermaidRenderer } from "@/components/tools/MermaidRenderer";
import "./index.css";

void mountTool(MermaidRenderer, { form: true });
