import { mountTool } from "./bootstrap";
import { QrGenerator } from "@/components/tools/QrGenerator";
import "./index.css";

void mountTool(QrGenerator, { form: false });
