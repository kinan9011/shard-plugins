import { mountTool } from "./bootstrap";
import { SecretRedactor } from "@/components/tools/SecretRedactor";
import "./index.css";

void mountTool(SecretRedactor, { form: false });
