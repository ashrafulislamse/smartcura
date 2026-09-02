class Doctor {
  final String id;
  final String name;
  final String specialty;
  final String imageUrl;
  final double rating;
  final int reviewCount;
  final int experience;
  final String hospital;
  final double consultationFee;
  final bool isAvailable;
  final String nextAvailable;
  final List<String> languages;
  final String about;

  Doctor({
    required this.id,
    required this.name,
    required this.specialty,
    required this.imageUrl,
    required this.rating,
    required this.reviewCount,
    required this.experience,
    required this.hospital,
    required this.consultationFee,
    required this.isAvailable,
    required this.nextAvailable,
    required this.languages,
    required this.about,
  });
}
