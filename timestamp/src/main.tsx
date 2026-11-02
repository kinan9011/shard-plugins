import { mountTool } from "./bootstrap";
import { TimestampConverter } from "@/components/tools/TimestampConverter";
import "./index.css";

void mountTool(TimestampConverter, { form: true });
