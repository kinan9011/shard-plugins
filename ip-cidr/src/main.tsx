import { mountTool } from "./bootstrap";
import { IpCidrCalculator } from "@/components/tools/IpCidrCalculator";
import "./index.css";

void mountTool(IpCidrCalculator, { form: true });
