import { mountTool } from "./bootstrap";
import { CertificateDecoder } from "@/components/tools/CertificateDecoder";
import "./index.css";

void mountTool(CertificateDecoder, { form: false });
