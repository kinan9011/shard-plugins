import { mountTool } from "./bootstrap";
import { BcryptGenerator } from "@/components/tools/BcryptGenerator";
import "./index.css";

void mountTool(BcryptGenerator, { form: true });
