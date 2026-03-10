import type { ReactNode } from "react";

interface AnalysisDetailSectionItem {
  id: string;
  title: string;
  subtitle: string;
  content: ReactNode;
}

interface AnalysisDetailSectionsProps {
  sections: AnalysisDetailSectionItem[];
}

export default function AnalysisDetailSections(props: AnalysisDetailSectionsProps) {
  const { sections } = props;

  if (sections.length === 0) {
    return null;
  }

  return (
    <section className="analysis-detail-stack">
      {sections.map((section) => (
        <details key={section.id} className="analysis-detail-section">
          <summary className="analysis-detail-summary">
            <div>
              <strong>{section.title}</strong>
              <small>{section.subtitle}</small>
            </div>
            <span className="analysis-detail-toggle" aria-hidden="true" />
          </summary>
          <div className="analysis-detail-body">{section.content}</div>
        </details>
      ))}
    </section>
  );
}
