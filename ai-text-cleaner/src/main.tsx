import { mountTool } from "./bootstrap";
import { AiTextCleaner } from "@/components/tools/AiTextCleaner";
import "./index.css";

void mountTool(AiTextCleaner, { form: false });
