import { mountTool } from "./bootstrap";
import { UrlEncoder } from "@/components/tools/UrlEncoder";
import "./index.css";

void mountTool(UrlEncoder, { form: false });
