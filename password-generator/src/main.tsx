import { mountTool } from "./bootstrap";
import { PasswordGenerator } from "@/components/tools/PasswordGenerator";
import "./index.css";

void mountTool(PasswordGenerator, { form: true });
