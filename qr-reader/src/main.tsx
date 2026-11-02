import { mountTool } from "./bootstrap";
import { QrReader } from "@/components/tools/QrReader";
import "./index.css";

void mountTool(QrReader, { form: false });
