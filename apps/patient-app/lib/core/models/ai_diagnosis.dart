class AIDiagnosis {
  final String id;
  final String condition;
  final double confidence;
  final String description;
  final DateTime timestamp;
  final List<String> symptoms;
  final List<DiagnosisRecommendation> recommendations;
  final Map<String, String> keyFindings;
  final String riskLevel;

  AIDiagnosis({
    required this.id,
    required this.condition,
    required this.confidence,
    required this.description,
    required this.timestamp,
    required this.symptoms,
    required this.recommendations,
    required this.keyFindings,
    required this.riskLevel,
  });
}

class DiagnosisRecommendation {
  final String title;
  final String description;
  final String icon;
  final String color;
  final String actionType;

  DiagnosisRecommendation({
    required this.title,
    required this.description,
    required this.icon,
    required this.color,
    required this.actionType,
  });
}

class SymptomCorrelation {
  final String symptom;
  final double intensity;
  final String location;
  final String color;

  SymptomCorrelation({
    required this.symptom,
    required this.intensity,
    required this.location,
    required this.color,
  });
}
