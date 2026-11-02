import { mountTool } from "./bootstrap";
import { SemverCalculator } from "@/components/tools/SemverCalculator";
import "./index.css";

void mountTool(SemverCalculator, { form: true });
