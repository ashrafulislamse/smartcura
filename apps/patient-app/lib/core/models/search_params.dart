import 'package:smartcura_contracts/smartcura_contracts.dart';

/// Parameters for the doctor directory search (GET /doctors).
///
/// Implements `==` / `hashCode` so that `FutureProvider.family` treats
/// two params with the same field values as the same family key. Without
/// this, every widget rebuild creates a new key, causing an infinite
/// re-fetch loop that keeps the screen in shimmer forever.
class DoctorSearchParams {
  final String? query;
  final String? specialty;
  final List<String> languages;
  final bool? acceptsNewPatients;
  final bool? verifiedOnly;
  final String? cursor;
  final int? limit;

  const DoctorSearchParams({
    this.query,
    this.specialty,
    this.languages = const [],
    this.acceptsNewPatients,
    this.verifiedOnly,
    this.cursor,
    this.limit,
  });

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is DoctorSearchParams &&
          query == other.query &&
          specialty == other.specialty &&
          languages.length == other.languages.length &&
          (languages.isEmpty ||
              languages.toString() == other.languages.toString()) &&
          acceptsNewPatients == other.acceptsNewPatients &&
          verifiedOnly == other.verifiedOnly &&
          cursor == other.cursor &&
          limit == other.limit;

  @override
  int get hashCode => Object.hash(
        query,
        specialty,
        Object.hashAll(languages),
        acceptsNewPatients,
        verifiedOnly,
        cursor,
        limit,
      );

  /// Converts to query parameters matching the backend's `GET /doctors` spec.
  ///
  /// Important: the `specialty` parameter must match pattern
  /// `^[a-z][a-z0-9_]{1,62}$` (lowercase, underscores). The caller is
  /// responsible for normalising display labels (e.g. "General Practice"
  /// → "general_practice") before constructing [DoctorSearchParams].
  ///
  /// The `language` parameter (singular) accepts a single ISO code like
  /// `en` or `ms`, not a comma-separated list.
  Map<String, dynamic> toQueryParams() {
    final params = <String, dynamic>{};
    if (query != null && query!.isNotEmpty) params['q'] = query;
    if (specialty != null && specialty!.isNotEmpty) {
      params['specialty'] = specialty;
    }
    if (languages.isNotEmpty) params['language'] = languages.first;
    if (acceptsNewPatients != null) {
      params['accepts_new_patients'] = acceptsNewPatients;
    }
    if (cursor != null && cursor!.isNotEmpty) params['cursor'] = cursor;
    if (limit != null) params['page_size'] = limit;
    return params;
  }

  DoctorSearchParams copyWith({
    String? query,
    String? specialty,
    List<String>? languages,
    bool? acceptsNewPatients,
    bool? verifiedOnly,
    String? cursor,
    int? limit,
  }) {
    return DoctorSearchParams(
      query: query ?? this.query,
      specialty: specialty ?? this.specialty,
      languages: languages ?? this.languages,
      acceptsNewPatients: acceptsNewPatients ?? this.acceptsNewPatients,
      verifiedOnly: verifiedOnly ?? this.verifiedOnly,
      cursor: cursor ?? this.cursor,
      limit: limit ?? this.limit,
    );
  }
}

/// Mapper for `DoctorDirectoryItem` (snake_case wire → generated type).
class DoctorDirectoryItemMapper {
  static DoctorDirectoryItem fromJson(Map<String, dynamic> j) =>
      DoctorDirectoryItem(
        membershipId: j['membership_id'] as String,
        organizationId: j['organization_id'] as String,
        displayName: j['display_name'] as String,
        imageUrl: j['image_url'] as String?,
        practiceName: j['practice_name'] as String,
        biography: j['biography'] as String?,
        yearsExperience: (j['years_experience'] as num?)?.toInt() ?? 0,
        consultationFeeSen: (j['consultation_fee_sen'] as num?)?.toInt() ?? 0,
        currency: j['currency'] as String,
        acceptsNewPatients: j['accepts_new_patients'] as bool? ?? false,
        verified: j['verified'] as bool? ?? false,
        primarySpecialty: j['primary_specialty'] as String?,
        specialties:
            (j['specialties'] as List<dynamic>).whereType<String>().toList(),
        languages:
            (j['languages'] as List<dynamic>).whereType<String>().toList(),
        ratingAverage: (j['rating_average'] as num?)?.toDouble() ?? 0,
        reviewCount: (j['review_count'] as num?)?.toInt() ?? 0,
        nextAvailableAt: j['next_available_at'] as String?,
      );
}

/// Mapper for `DoctorDirectoryPage` (paginated list).
class DoctorDirectoryPageMapper {
  static DoctorDirectoryPage fromJson(Map<String, dynamic> j) =>
      DoctorDirectoryPage(
        data: (j['data'] as List<dynamic>)
            .whereType<Map<String, dynamic>>()
            .map(DoctorDirectoryItemMapper.fromJson)
            .toList(),
        page: PageInfoMapper.fromJson(j['page'] as Map<String, dynamic>),
      );
}

/// Mapper for `PageInfo`.
class PageInfoMapper {
  static PageInfo fromJson(Map<String, dynamic> j) => PageInfo(
        hasMore: j['has_more'] as bool? ?? false,
        nextCursor: j['next_cursor'] as String?,
      );
}

/// Mapper for `PublicDoctorReview`.
class PublicDoctorReviewMapper {
  static PublicDoctorReview fromJson(Map<String, dynamic> j) =>
      PublicDoctorReview(
        id: j['id'] as String,
        rating: (j['rating'] as num).toInt(),
        comment: j['comment'] as String?,
        tags: (j['tags'] as List<dynamic>)
            .whereType<String>()
            .map(doctorReviewTagFromWire)
            .toList(),
        createdAt: j['created_at'] as String,
        updatedAt: j['updated_at'] as String,
      );
}

/// Mapper for `DoctorReviewPage`.
class DoctorReviewPageMapper {
  static DoctorReviewPage fromJson(Map<String, dynamic> j) => DoctorReviewPage(
        data: (j['data'] as List<dynamic>)
            .whereType<Map<String, dynamic>>()
            .map(PublicDoctorReviewMapper.fromJson)
            .toList(),
        page: PageInfoMapper.fromJson(j['page'] as Map<String, dynamic>),
      );
}
