import { mountTool } from "./bootstrap";
import { Base64Converter } from "@/components/tools/Base64Converter";
import "./index.css";

void mountTool(Base64Converter, { form: false });
