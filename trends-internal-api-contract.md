# Trends Internal API Contract

## 1. Purpose

This contract defines the internal APIs for Trends alert rules and their alerts.

The contract supports these operations:

- Read alert categories.
- Create and manage Trends alert rules.
- Read Trends alerts for a specified time range.
- Read alert hit timelines.
- Submit and read alert feedback.
- Read camera information.
- Fetch alert images from returned URLs.

This contract excludes category mutation, camera mutation, alert deletion, and alert rule deletion.

## 2. Access and authentication

### 2.1 Base URL

Use the direct Central Brain internal URL:

```text
http://<central-brain-host>:<central-brain-port>
```

Set this value in the examples:

```bash
export CENTRAL_BRAIN_INTERNAL_BASE_URL="http://<central-brain-host>:<central-brain-port>"
export CENTRAL_BRAIN_INTERNAL_API_KEY="<internal-api-key>"
```

### 2.2 Authentication header

Send this header with every `/internal` API request:

```http
X-INTERNAL-API-KEY: <internal-api-key>
```

Example:

```bash
curl "${CENTRAL_BRAIN_INTERNAL_BASE_URL}/internal/alert_categories?page=1&size=50" \
  --header "X-INTERNAL-API-KEY: ${CENTRAL_BRAIN_INTERNAL_API_KEY}"
```

The API returns HTTP `401` when the key is missing or incorrect:

```json
{
  "message": "unauthorized internal api key"
}
```

Warning: The key provides access to all Central Brain internal APIs. Store it only in a secret store.

Do not send the key in a query parameter, log entry, or client-side application.

### 2.3 Content types

Most endpoints use query parameters and return JSON.

The feedback endpoint accepts an `application/json` body.

Alert rule create and update endpoints can also accept a multipart `file`.

### 2.4 Alert image access

Each alert response contains an absolute `image_path`.

Fetch this URL without changes. Do not add a cluster ID or construct a media path.

The image URL is a media resource. It does not use the Central Brain internal API key.

Network access controls can still restrict access to the media URL.

## 3. Entity model

### 3.1 Alert category

An alert category groups related alert rules.

Every Trends alert rule must reference one existing category through `category_id`.

The category response includes Wordmap fields such as `weight`.

Those fields do not define Trends behavior and are not used in this contract.

Important fields:

- `alert_category_id`: The stable category identifier.
- `name`: The category display name.
- `weight`: A Wordmap-specific field that Trends clients can ignore.
- `color`: An optional hexadecimal display color.
- `created_at`: The category creation time.
- `updated_at`: The last category update time.

One category can support many Trends alert rules.

### 3.2 Alert rule

An alert rule defines the visual condition that the alert engine evaluates.

A Trends alert rule always has `alert_rule_type=trends`.

Trends rules use the same alert engine processing as normal rules.

Important fields:

- `alert_rule_id`: The stable rule identifier.
- `query_text`: The visual condition to detect.
- `image_path`: An optional reference image for the rule.
- `category_id`: The required supporting category identifier.
- `alert_rule_type`: Always `trends` in this contract.
- `camera_ids`: Optional camera restrictions.
- `camera_group_ids`: Optional camera group restrictions.
- `cluster_ids`: Optional internal scope restrictions.
- `poly_coords`: Optional geographic restrictions.
- `description`: An optional rule description.
- `severity`: `low`, `medium`, `high`, or `critical`.
- `status`: `active` or `paused`.
- `is_preprocessed`: The alert engine preparation state.
- `is_silenced`: The notification silence state.
- `created_at`: The rule creation time.
- `updated_at`: The last rule update time.

The rule does not produce alerts until `is_preprocessed` is `true`.

An active rule can produce alerts. A paused rule remains stored but produces no new alerts.

One Trends alert rule can produce many alerts.

### 3.3 Alert

An alert represents one detected event for one Trends alert rule.

Important fields:

- `alert_id`: The stable alert identifier.
- `alert_rule_id`: The rule that produced the alert.
- `document_id`: The detected frame document identifier.
- `camera_id`: The camera that produced the frame.
- `timestamp`: The frame time in UTC Unix epoch seconds.
- `score`: The alert match score.
- `image_path`: The absolute alert image URL.
- `status`: The alert workflow state.
- `feedback`: The latest `like`, `dislike`, or `neutral` value.
- `feedback_type`: The source of the latest feedback.
- `hits`: The total sightings for the alert.
- `alert_rule`: A compact rule snapshot.
- `camera`: The camera details.
- `created_at`: The database creation time.
- `updated_at`: The last alert update time.

The latest feedback write replaces the previous feedback value and source.

### 3.4 Alert hit

An alert hit represents a later sighting that matches an existing alert.

Important fields:

- `id`: The hit row identifier.
- `alert_id`: The parent alert identifier.
- `timestamp`: The sighting time in UTC Unix epoch seconds.
- `value`: The number of sightings represented by the row.
- `created_at`: The hit row creation time.

The original alert counts as one sighting.

The total is:

```text
total_hits = 1 + SUM(hit.value)
```

### 3.5 Feedback

Feedback records the latest assessment of an alert.

The supported feedback values are:

- `like`
- `dislike`
- `neutral`

The supported feedback types are:

- `user`
- `system`

If `feedback_type` is omitted, the API uses `user`.

Only user feedback can enter the feedback image archive.

System feedback updates the alert but does not enter that archive.

The API keeps one current feedback value and one current feedback type.

### 3.6 Relationships

```text
Alert Category
  └── Trends Alert Rule
        └── Alert
              ├── Alert Hits
              ├── Feedback
              ├── Camera
              └── Alert Image
```

## 4. Common request rules

### 4.1 Trends filter

Send `alert_rule_type=trends` on rule create, rule update, rule list, rule count, alert list, and alert count requests.

Do not use `alert_rule_type=all` for this integration.

ID-based APIs do not accept an alert rule type parameter.

Use only IDs returned by Trends-filtered list calls with those APIs.

### 4.2 Time range

`from_timestamp` and `to_timestamp` use UTC Unix epoch seconds.

Alert list calls include both values:

```text
from_timestamp <= alert.timestamp <= to_timestamp
```

The start and end values are inclusive for alert filtering.

### 4.3 Pagination

Use a positive `page` and `size` on every list request.

This contract uses `page=1&size=50`.

The `count` field on a list response is the returned page length.

Use the related count endpoint when you need the total result count.

### 4.4 Sorting

Supported sort values include:

- `recency`
- `relevancy`
- `created_at`
- `updated_at`

Supported sort orders are `asc` and `desc`.

### 4.5 Common status codes

- `200`: The request succeeded.
- `201`: The resource was created.
- `400`: A required field or valid combination is missing.
- `401`: The internal API key is missing or incorrect.
- `404`: The requested resource does not exist.
- `409`: The requested resource conflicts with existing data.
- `422`: A parameter has an invalid type or enum value.
- `500`: The server could not complete the request.

## 5. Alert category APIs

### 5.1 Count alert categories

Use this endpoint to get the total category count.

```http
GET /internal/alert_categories/count
```

Optional query parameters:

- `search`: Search within category names.
- `category_id`: Filter by one category ID. Repeat it for multiple IDs.

Example:

```bash
curl --get "${CENTRAL_BRAIN_INTERNAL_BASE_URL}/internal/alert_categories/count" \
  --header "X-INTERNAL-API-KEY: ${CENTRAL_BRAIN_INTERNAL_API_KEY}" \
  --data-urlencode "search=safety"
```

Response:

```json
{
  "count": 4
}
```

### 5.2 List alert categories

Use this endpoint to find a category before Trends rule creation.

```http
GET /internal/alert_categories
```

Query parameters:

- `search`: Optional category name search.
- `category_id`: Optional repeated category ID filter.
- `page`: Page number.
- `size`: Page size.
- `sort_by`: `created_at` or `updated_at`.
- `sort_order`: `asc` or `desc`.

Example:

```bash
curl --get "${CENTRAL_BRAIN_INTERNAL_BASE_URL}/internal/alert_categories" \
  --header "X-INTERNAL-API-KEY: ${CENTRAL_BRAIN_INTERNAL_API_KEY}" \
  --data-urlencode "page=1" \
  --data-urlencode "size=50" \
  --data-urlencode "sort_by=created_at" \
  --data-urlencode "sort_order=desc"
```

Response:

```json
{
  "count": 2,
  "alert_categories": [
    {
      "alert_category_id": "alert-category-safety",
      "name": "Safety",
      "weight": 3.0,
      "color": "#FF5733",
      "created_at": "2026-08-31T10:15:30Z",
      "updated_at": "2026-08-31T10:15:30Z"
    },
    {
      "alert_category_id": "alert-category-operations",
      "name": "Operations",
      "weight": 1.5,
      "color": null,
      "created_at": "2026-08-30T09:00:00Z",
      "updated_at": "2026-08-30T09:00:00Z"
    }
  ]
}
```

### 5.3 Get one alert category

```http
GET /internal/alert_category/{alert_category_id}
```

Path parameter:

- `alert_category_id`: The required category ID.

Example:

```bash
curl "${CENTRAL_BRAIN_INTERNAL_BASE_URL}/internal/alert_category/alert-category-safety" \
  --header "X-INTERNAL-API-KEY: ${CENTRAL_BRAIN_INTERNAL_API_KEY}"
```

Response:

```json
{
  "alert_category_id": "alert-category-safety",
  "name": "Safety",
  "weight": 3.0,
  "color": "#FF5733",
  "created_at": "2026-08-31T10:15:30Z",
  "updated_at": "2026-08-31T10:15:30Z"
}
```

## 6. Trends alert rule APIs

### 6.1 Create a Trends alert rule

```http
POST /internal/alert_rule
```

Required query parameters:

- `alert_rule_type`: Always `trends`.
- `category_id`: An existing alert category ID.
- One visual input: `query_text`, `image_path`, or multipart `file`.

Common optional query parameters:

- `alert_rule_id`: A caller-supplied rule ID.
- `description`: A rule description.
- `severity`: `low`, `medium`, `high`, or `critical`.
- `status`: `active` or `paused`.
- `camera_ids`: Repeat for multiple camera IDs.
- `camera_group_ids`: Repeat for multiple camera group IDs.
- `cluster_ids`: Repeat for multiple internal scopes.
- `poly_coords`: Repeat `lat,lon` values for a geographic polygon.

Omit all camera and location scopes to evaluate all enabled cameras.

Example:

```bash
curl --request POST --get "${CENTRAL_BRAIN_INTERNAL_BASE_URL}/internal/alert_rule" \
  --header "X-INTERNAL-API-KEY: ${CENTRAL_BRAIN_INTERNAL_API_KEY}" \
  --data-urlencode "alert_rule_type=trends" \
  --data-urlencode "category_id=alert-category-safety" \
  --data-urlencode "query_text=person without a safety helmet" \
  --data-urlencode "camera_ids=camera-gate-a" \
  --data-urlencode "description=Track safety helmet trend" \
  --data-urlencode "severity=high" \
  --data-urlencode "status=active"
```

Success response:

```json
{
  "message": "alert rule created",
  "id": "alert-rule-trend-001"
}
```

The API returns HTTP `400` when `category_id` is missing.

The API returns HTTP `404` when the category does not exist.

The API returns HTTP `409` when the requested rule ID already exists.

### 6.2 Count Trends alert rules

```http
GET /internal/alert_rules/count
```

Required query parameter:

- `alert_rule_type`: Always `trends`.

Optional query parameters:

- `search`
- `camera_id`
- `severity`
- `status`
- `category_id`
- `is_preprocessed`
- `is_deleted`

Example:

```bash
curl --get "${CENTRAL_BRAIN_INTERNAL_BASE_URL}/internal/alert_rules/count" \
  --header "X-INTERNAL-API-KEY: ${CENTRAL_BRAIN_INTERNAL_API_KEY}" \
  --data-urlencode "alert_rule_type=trends" \
  --data-urlencode "is_deleted=false"
```

Response:

```json
{
  "count": 7
}
```

### 6.3 List Trends alert rules

```http
GET /internal/alert_rules
```

Required query parameter:

- `alert_rule_type`: Always `trends`.

List query parameters:

- `page`: Required by this contract.
- `size`: Required by this contract.
- `search`: Optional query text search.
- `camera_id`: Optional camera filter.
- `severity`: Optional severity filter.
- `status`: Optional `active` or `paused` filter.
- `category_id`: Optional repeated category filter.
- `is_preprocessed`: Optional preprocessing state filter.
- `is_deleted`: Optional deletion state filter.
- `get_category`: Include the full category object.

Example:

```bash
curl --get "${CENTRAL_BRAIN_INTERNAL_BASE_URL}/internal/alert_rules" \
  --header "X-INTERNAL-API-KEY: ${CENTRAL_BRAIN_INTERNAL_API_KEY}" \
  --data-urlencode "alert_rule_type=trends" \
  --data-urlencode "page=1" \
  --data-urlencode "size=50" \
  --data-urlencode "get_category=true" \
  --data-urlencode "is_deleted=false"
```

Response:

```json
{
  "count": 1,
  "alert_rules": [
    {
      "alert_rule_id": "alert-rule-trend-001",
      "query_text": "person without a safety helmet",
      "image_path": null,
      "category_id": "alert-category-safety",
      "alert_rule_type": "trends",
      "poly_coords": null,
      "camera_ids": [
        "camera-gate-a"
      ],
      "camera_group_ids": null,
      "cluster_ids": null,
      "description": "Track safety helmet trend",
      "severity": "high",
      "status": "active",
      "created_at": "2026-09-01T04:10:00Z",
      "updated_at": "2026-09-01T04:10:05Z",
      "is_deleted": false,
      "is_preprocessed": true,
      "is_silenced": false,
      "category": {
        "alert_category_id": "alert-category-safety",
        "name": "Safety",
        "weight": 3.0,
        "color": "#FF5733",
        "created_at": "2026-08-31T10:15:30Z",
        "updated_at": "2026-08-31T10:15:30Z"
      }
    }
  ]
}
```

### 6.4 Get one Trends alert rule

```http
GET /internal/alert_rule/{alert_rule_id}
```

Query parameter:

- `get_category`: Set `true` to include the supporting category.

This ID endpoint has no alert rule type parameter.

Use an ID from the Trends rule list.

Example:

```bash
curl --get "${CENTRAL_BRAIN_INTERNAL_BASE_URL}/internal/alert_rule/alert-rule-trend-001" \
  --header "X-INTERNAL-API-KEY: ${CENTRAL_BRAIN_INTERNAL_API_KEY}" \
  --data-urlencode "get_category=true"
```

The response is one full alert rule object.

### 6.5 Update a Trends alert rule

```http
PUT /internal/alert_rule/{alert_rule_id}
```

Send only fields that must change.

Always include this query parameter:

```text
alert_rule_type=trends
```

The rule must keep a valid `category_id`.

Do not send an empty `category_id`.

Changes to the query or rule image restart preprocessing.

Example:

```bash
curl --request PUT --get \
  "${CENTRAL_BRAIN_INTERNAL_BASE_URL}/internal/alert_rule/alert-rule-trend-001" \
  --header "X-INTERNAL-API-KEY: ${CENTRAL_BRAIN_INTERNAL_API_KEY}" \
  --data-urlencode "alert_rule_type=trends" \
  --data-urlencode "category_id=alert-category-safety" \
  --data-urlencode "query_text=person without required head protection" \
  --data-urlencode "severity=critical"
```

Response:

```json
{
  "message": "alert rule updated"
}
```

### 6.6 Pause a Trends alert rule

```bash
curl --request PUT --get \
  "${CENTRAL_BRAIN_INTERNAL_BASE_URL}/internal/alert_rule/alert-rule-trend-001" \
  --header "X-INTERNAL-API-KEY: ${CENTRAL_BRAIN_INTERNAL_API_KEY}" \
  --data-urlencode "alert_rule_type=trends" \
  --data-urlencode "status=paused"
```

### 6.7 Resume a Trends alert rule

```bash
curl --request PUT --get \
  "${CENTRAL_BRAIN_INTERNAL_BASE_URL}/internal/alert_rule/alert-rule-trend-001" \
  --header "X-INTERNAL-API-KEY: ${CENTRAL_BRAIN_INTERNAL_API_KEY}" \
  --data-urlencode "alert_rule_type=trends" \
  --data-urlencode "status=active"
```

## 7. Trends alert APIs

### 7.1 Count Trends alerts for one rule and time range

```http
GET /internal/alerts/count
```

Required query parameters for this contract:

- `alert_rule_type`: Always `trends`.
- `alert_rule_id`: One Trends alert rule ID.
- `from_timestamp`: The inclusive start time.
- `to_timestamp`: The inclusive end time.

Common optional filters:

- `camera_id`
- `category_id`
- `status`
- `severity`
- `is_read`
- `is_silenced`
- `is_deleted`

Example:

```bash
curl --get "${CENTRAL_BRAIN_INTERNAL_BASE_URL}/internal/alerts/count" \
  --header "X-INTERNAL-API-KEY: ${CENTRAL_BRAIN_INTERNAL_API_KEY}" \
  --data-urlencode "alert_rule_type=trends" \
  --data-urlencode "alert_rule_id=alert-rule-trend-001" \
  --data-urlencode "from_timestamp=1788148800" \
  --data-urlencode "to_timestamp=1788235200" \
  --data-urlencode "is_deleted=false"
```

Response:

```json
{
  "count": 12,
  "hits": 28
}
```

The endpoint windows alerts and later hit events independently.

`count` is the number of matching alert rows.

`hits` is the total number of sightings within the requested window.

### 7.2 List Trends alerts for one rule and time range

```http
GET /internal/alerts
```

Required query parameters for this contract:

- `alert_rule_type`: Always `trends`.
- `alert_rule_id`: One Trends alert rule ID.
- `from_timestamp`: The inclusive start time.
- `to_timestamp`: The inclusive end time.
- `page`: A positive page number.
- `size`: A positive page size.

Common optional query parameters:

- `camera_id`: Repeat for multiple cameras.
- `category_id`: Repeat for multiple categories.
- `status`: Repeat for multiple workflow states.
- `severity`: Repeat for multiple severities.
- `is_read`
- `is_silenced`
- `is_deleted`
- `sort_by`
- `sort_order`
- `get_category`: Include the category in the rule snapshot.

Example:

```bash
curl --get "${CENTRAL_BRAIN_INTERNAL_BASE_URL}/internal/alerts" \
  --header "X-INTERNAL-API-KEY: ${CENTRAL_BRAIN_INTERNAL_API_KEY}" \
  --data-urlencode "alert_rule_type=trends" \
  --data-urlencode "alert_rule_id=alert-rule-trend-001" \
  --data-urlencode "from_timestamp=1788148800" \
  --data-urlencode "to_timestamp=1788235200" \
  --data-urlencode "page=1" \
  --data-urlencode "size=50" \
  --data-urlencode "sort_by=recency" \
  --data-urlencode "sort_order=desc" \
  --data-urlencode "get_category=true"
```

Response:

```json
{
  "count": 1,
  "alerts": [
    {
      "alert_id": "alert-trend-1001",
      "alert_rule_id": "alert-rule-trend-001",
      "document_id": "document-4821",
      "cluster_id": "opaque-internal-scope",
      "camera_id": "camera-gate-a",
      "timestamp": 1788196500,
      "score": 0.91,
      "image_path": "https://media.internal.example/.../frame-4821.jpg",
      "assignee_id": null,
      "status": "new",
      "is_read": false,
      "is_deleted": false,
      "is_defunct": false,
      "is_eligible": true,
      "feedback": "like",
      "feedback_type": "system",
      "hits": 3,
      "alert_rule": {
        "alert_rule_id": "alert-rule-trend-001",
        "query_text": "person without a safety helmet",
        "alert_rule_type": "trends",
        "category_id": "alert-category-safety",
        "severity": "high",
        "is_silenced": false,
        "category": {
          "alert_category_id": "alert-category-safety",
          "name": "Safety",
          "weight": 3.0,
          "color": "#FF5733",
          "created_at": "2026-08-31T10:15:30Z",
          "updated_at": "2026-08-31T10:15:30Z"
        }
      },
      "camera": {
        "camera_id": "camera-gate-a",
        "name": "Gate A",
        "enabled_trvision": true
      },
      "created_at": "2026-09-01T05:15:01Z",
      "updated_at": "2026-09-01T05:20:00Z",
      "metadata_dict": {}
    }
  ]
}
```

The returned `hits` value is the alert's lifetime sighting total.

Use the count endpoint when you need hit totals limited to the requested time range.

### 7.3 Get one Trends alert

```http
GET /internal/alert/{alert_rule_id}/{document_id}
```

Path parameters:

- `alert_rule_id`: The Trends rule ID.
- `document_id`: The alert document ID.

Optional query parameters:

- `get_category`
- `get_report`
- `get_remarks`

This ID endpoint has no alert rule type parameter.

Use IDs from a Trends-filtered alert list.

Example:

```bash
curl --get \
  "${CENTRAL_BRAIN_INTERNAL_BASE_URL}/internal/alert/alert-rule-trend-001/document-4821" \
  --header "X-INTERNAL-API-KEY: ${CENTRAL_BRAIN_INTERNAL_API_KEY}" \
  --data-urlencode "get_category=true"
```

The response is one full alert object.

Read `feedback` and `feedback_type` from this response.

## 8. Alert hit API

### 8.1 Get the hit timeline

```http
GET /internal/alerts/{alert_id}/hits
```

This ID endpoint has no alert rule type parameter.

Use an `alert_id` from a Trends-filtered alert list.

Example:

```bash
curl "${CENTRAL_BRAIN_INTERNAL_BASE_URL}/internal/alerts/alert-trend-1001/hits" \
  --header "X-INTERNAL-API-KEY: ${CENTRAL_BRAIN_INTERNAL_API_KEY}"
```

Response:

```json
{
  "count": 2,
  "total_hits": 5,
  "hits": [
    {
      "id": 101,
      "alert_id": "alert-trend-1001",
      "timestamp": 1788196560,
      "value": 2,
      "created_at": "2026-09-01T05:16:00Z"
    },
    {
      "id": 102,
      "alert_id": "alert-trend-1001",
      "timestamp": 1788196620,
      "value": 2,
      "created_at": "2026-09-01T05:17:00Z"
    }
  ]
}
```

`count` is the number of returned hit rows.

`total_hits` includes the original alert and all represented later sightings.

The timeline is ordered from oldest to newest.

## 9. Alert feedback API

### 9.1 Submit system feedback

```http
POST /internal/alerts/feedback
Content-Type: application/json
```

Send one alert item for this integration.

Example:

```bash
curl --request POST \
  "${CENTRAL_BRAIN_INTERNAL_BASE_URL}/internal/alerts/feedback" \
  --header "X-INTERNAL-API-KEY: ${CENTRAL_BRAIN_INTERNAL_API_KEY}" \
  --header "Content-Type: application/json" \
  --data '{
    "alert_feedbacks": [
      {
        "alert_id": "alert-trend-1001",
        "feedback": "like",
        "feedback_type": "system"
      }
    ]
  }'
```

Response:

```json
{
  "message": "feedback submitted successfully"
}
```

System feedback does not add the image to the user feedback archive.

### 9.2 Submit user feedback

Set `feedback_type=user`, or omit the field.

Example with the default:

```json
{
  "alert_feedbacks": [
    {
      "alert_id": "alert-trend-1001",
      "feedback": "dislike"
    }
  ]
}
```

The API stores this result:

```json
{
  "feedback": "dislike",
  "feedback_type": "user"
}
```

### 9.3 Feedback overwrite behavior

The API stores only the latest feedback value and source.

For example, system feedback can replace user feedback.

User feedback can also replace system feedback.

The API does not keep feedback history.

### 9.4 Read feedback

Read feedback from either endpoint:

```http
GET /internal/alerts
GET /internal/alert/{alert_rule_id}/{document_id}
```

The fields are:

```json
{
  "feedback": "like",
  "feedback_type": "system"
}
```

Both fields are `null` before the first feedback write.

## 10. Camera APIs

### 10.1 List cameras

```http
GET /internal/cameras
```

Use this endpoint to find camera IDs for rule scope and alert display.

Common query parameters:

- `camera_id`: Repeat for multiple camera IDs.
- `camera_group_id`: Repeat for multiple camera groups.
- `enabled_trvision`: Default `true`.
- `vms_id`: Filter by a VMS identifier.
- `poly_coords`: Repeat `lat,lon` values for a polygon.
- `get_vms`: Include VMS details.
- `get_user_groups`: Include user group details.
- `get_camera_groups`: Include camera group details.
- `is_deleted`: Default `false`.
- `page`: A positive page number.
- `size`: A positive page size.

Example:

```bash
curl --get "${CENTRAL_BRAIN_INTERNAL_BASE_URL}/internal/cameras" \
  --header "X-INTERNAL-API-KEY: ${CENTRAL_BRAIN_INTERNAL_API_KEY}" \
  --data-urlencode "enabled_trvision=true" \
  --data-urlencode "is_deleted=false" \
  --data-urlencode "page=1" \
  --data-urlencode "size=50"
```

Response:

```json
{
  "count": 2,
  "cameras": [
    {
      "camera_id": "camera-gate-a",
      "client_camera_id": "external-camera-10",
      "name": "Gate A",
      "location": {
        "lon": 55.2708,
        "lat": 25.2048
      },
      "enabled_trvision": true,
      "is_deleted": false,
      "created_at": "2026-08-20T08:00:00Z",
      "updated_at": "2026-08-30T11:00:00Z"
    }
  ]
}
```

### 10.2 Get one camera

```http
GET /internal/camera/{camera_id}
```

Optional query parameters:

- `get_vms`: Include the full VMS object.
- `get_user_groups`: Include user groups with camera access.
- `get_users`: Include users with camera access.
- `get_camera_groups`: Include the camera groups.

Example:

```bash
curl --get "${CENTRAL_BRAIN_INTERNAL_BASE_URL}/internal/camera/camera-gate-a" \
  --header "X-INTERNAL-API-KEY: ${CENTRAL_BRAIN_INTERNAL_API_KEY}" \
  --data-urlencode "get_vms=false" \
  --data-urlencode "get_user_groups=false" \
  --data-urlencode "get_users=false" \
  --data-urlencode "get_camera_groups=false"
```

Response:

```json
{
  "camera_id": "camera-gate-a",
  "client_camera_id": "external-camera-10",
  "vms_id": "vms-main",
  "name": "Gate A",
  "location": {
    "lon": 55.2708,
    "lat": 25.2048
  },
  "cluster_id": "opaque-internal-scope",
  "enabled_trvision": true,
  "stream_url": "rtsp://<camera-stream-address>",
  "ip_address": "<camera-ip-address>",
  "is_deleted": false,
  "created_at": "2026-08-20T08:00:00Z",
  "updated_at": "2026-08-30T11:00:00Z",
  "vms": null,
  "user_groups": null,
  "users": null,
  "camera_groups": null
}
```

The camera list returns the same camera fields inside its `cameras` array.

Related objects are `null` unless their matching `get_*` parameter is `true`.

Treat `cluster_id` as opaque. It is not necessary for alert or image requests.

## 11. Alert image retrieval

### 11.1 Get the image URL

Read `image_path` from a Trends alert list or detail response.

Example value:

```json
{
  "image_path": "https://media.internal.example/.../frame-4821.jpg"
}
```

Treat this URL as opaque.

Do not derive it from `camera_id`, `cluster_id`, or `document_id`.

### 11.2 Download the image

```bash
curl --output "alert-trend-1001.jpg" \
  "https://media.internal.example/.../frame-4821.jpg"
```

The response body contains the image bytes.

The response `Content-Type` identifies the image format.

The media service can return `404` after image retention removes the source file.

## 12. Recommended integration sequence

1. List alert categories.
2. Select the supporting category ID.
3. List cameras when the rule needs camera scope.
4. Create the Trends alert rule with `alert_rule_type=trends`.
5. Poll the rule until `is_preprocessed=true`.
6. List Trends alerts with the rule ID and both time bounds.
7. Use `image_path` to fetch an alert image.
8. Use `alert_id` to read the hit timeline.
9. Submit system or user feedback.
10. Read the alert again to confirm feedback.
11. Pause or resume the rule when necessary.

## 13. Contract restrictions

- Always use `/internal` API paths.
- Always send the internal API key on API requests.
- Always use `alert_rule_type=trends` where the parameter exists.
- Always specify one rule ID and both time bounds for alert lists.
- Always use bounded pagination.
- Always use a valid category for a Trends rule.
- Never use category mutation APIs through this contract.
- Never use camera mutation APIs through this contract.
- Never call a cluster API directly.
- Never construct an alert image URL.
