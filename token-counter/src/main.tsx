import { mountTool } from "./bootstrap";
import { TokenCounter } from "@/components/tools/TokenCounter";
import "./index.css";

void mountTool(TokenCounter, { form: false });
