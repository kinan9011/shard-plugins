import { mountTool } from "./bootstrap";
import { CsvToJsonConverter } from "@/components/tools/CsvToJsonConverter";
import "./index.css";

void mountTool(CsvToJsonConverter, { form: false });
