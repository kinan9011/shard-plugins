import { mountTool } from "./bootstrap";
import { TimeZoneConverter } from "@/components/tools/TimeZoneConverter";
import "./index.css";

void mountTool(TimeZoneConverter, { form: true });
