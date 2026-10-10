# ============================================================
# ResQFlow - Emergency Route Optimization System
# app.py
# ============================================================

from flask import Flask, jsonify, render_template, request, session
from pathlib import Path
from functools import wraps
from datetime import datetime, timezone

from werkzeug.security import generate_password_hash, check_password_hash

import sqlite3
import os
import math
import json
import re
import hashlib
import subprocess
import urllib.parse
import urllib.request


# ============================================================
# 1. FLASK CONFIGURATION
# ============================================================

app = Flask(__name__)

BASE_DIR = Path(__file__).resolve().parent

DATABASE = BASE_DIR / "resqflow.db"
GRAPH_FILE = BASE_DIR / "graph.csv"

if os.name == "nt":
    DSA_PROGRAM = BASE_DIR / "dsa_algorithms.exe"
else:
    DSA_PROGRAM = BASE_DIR / "dsa_algorithms"


# Secret key
app.secret_key = os.environ.get(
    "RESQFLOW_SECRET",
    "change-this-secret-key-in-production"
)


# Session configuration
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get(
        "FLASK_ENV",
        ""
    ).lower() == "production",
    JSON_SORT_KEYS=False
)


# ============================================================
# 2. DATABASE
# ============================================================

def get_database():
    """
    Create and return a SQLite database connection.
    """

    connection = sqlite3.connect(
        str(DATABASE),
        timeout=10
    )

    connection.row_factory = sqlite3.Row

    return connection


def initialize_database():
    """
    Create all required tables if they do not already exist.
    """

    connection = get_database()

    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS route_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            start_text TEXT NOT NULL,
            destination_text TEXT NOT NULL,
            mode TEXT NOT NULL,
            emergency_type TEXT,
            recommended_index INTEGER,
            route_count INTEGER NOT NULL,
            created_at TEXT NOT NULL,

            FOREIGN KEY(user_id)
            REFERENCES users(id)
            ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS incidents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            incident_type TEXT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            radius_m REAL NOT NULL DEFAULT 80,
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS gps_positions (
            id INTEGER PRIMARY KEY CHECK(id = 1),
            vehicle_id TEXT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            accuracy REAL,
            speed REAL,
            heading REAL,
            updated_at TEXT NOT NULL
        );
        """
    )

    connection.commit()
    connection.close()


def current_time():
    """
    Return UTC timestamp.
    """

    return datetime.now(timezone.utc).isoformat()


# ============================================================
# 3. LOGIN HELPERS
# ============================================================

def login_required(function):
    """
    Protect API routes that require authentication.
    """

    @wraps(function)
    def wrapper(*args, **kwargs):

        if not session.get("user_id"):

            return jsonify({
                "success": False,
                "message": "Please sign in first."
            }), 401

        return function(*args, **kwargs)

    return wrapper


def get_current_user():
    """
    Return currently logged-in user.
    """

    user_id = session.get("user_id")

    if not user_id:
        return None

    connection = get_database()

    user = connection.execute(
        """
        SELECT
            id,
            name,
            email,
            role,
            created_at
        FROM users
        WHERE id = ?
        """,
        (user_id,)
    ).fetchone()

    connection.close()

    if not user:
        return None

    return dict(user)


# ============================================================
# 4. DISTANCE CALCULATION
# ============================================================

def calculate_distance(lat1, lon1, lat2, lon2):

    earth_radius = 6371000.0

    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)

    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)

    value = (
        math.sin(d_lat / 2) ** 2
        +
        math.cos(lat1_rad)
        * math.cos(lat2_rad)
        * math.sin(d_lon / 2) ** 2
    )

    value = min(
        1.0,
        max(0.0, value)
    )

    return (
        2
        * earth_radius
        * math.asin(math.sqrt(value))
    )


# ============================================================
# 5. DEMO LOCATIONS
# ============================================================

DEMO_LOCATIONS = {

    "delhi": (28.6139, 77.2090),
    "new delhi": (28.6139, 77.2090),

    "dehradun": (30.3165, 78.0322),

    "haridwar": (29.9457, 78.1642),

    "roorkee": (29.8543, 77.8880),

    "rishikesh": (30.0869, 78.2676),

    "mussoorie": (30.4598, 78.0664),

    "noida": (28.5355, 77.3910),

    "gurugram": (28.4595, 77.0266),
    "gurgaon": (28.4595, 77.0266),

    "meerut": (28.9845, 77.7064),

    "chandigarh": (30.7333, 76.7794),

    "lucknow": (26.8467, 80.9462),

    "jaipur": (26.9124, 75.7873),

    "agra": (27.1767, 78.0081),

    "bareilly": (28.3670, 79.4304),

    "haldwani": (29.2183, 79.5130),

    "nainital": (29.3919, 79.4542),

    "mumbai": (19.0760, 72.8777),

    "kolkata": (22.5726, 88.3639),

    "bengaluru": (12.9716, 77.5946),
    "bangalore": (12.9716, 77.5946)
}


# ============================================================
# 6. LOCAL GEOCODING
# ============================================================

def local_geocode(text):

    if not text:
        return None

    text = str(text).strip()

    coordinate_pattern = (
        r"^\s*(-?\d+(?:\.\d+)?)\s*,\s*"
        r"(-?\d+(?:\.\d+)?)\s*$"
    )

    match = re.match(
        coordinate_pattern,
        text
    )

    if match:

        latitude = float(match.group(1))
        longitude = float(match.group(2))

        if (
            -90 <= latitude <= 90
            and
            -180 <= longitude <= 180
        ):

            return {
                "lat": latitude,
                "lng": longitude,
                "display": text,
                "source": "Coordinates"
            }

    key = re.sub(
        r"\s+",
        " ",
        text.lower()
    ).strip()

    if key in DEMO_LOCATIONS:

        latitude, longitude = DEMO_LOCATIONS[key]

        return {
            "lat": latitude,
            "lng": longitude,
            "display": text.title(),
            "source": "ResQFlow demo fallback"
        }

    for name, coordinates in DEMO_LOCATIONS.items():

        if len(name) >= 4 and (
            name in key
            or
            key in name
        ):

            latitude, longitude = coordinates

            return {
                "lat": latitude,
                "lng": longitude,
                "display": text.title(),
                "source": "ResQFlow demo fallback"
            }

    return None


# ============================================================
# 7. ONLINE GEOCODING
# ============================================================

def geocode_location(text):

    if not text:
        return None

    local_result = local_geocode(text)

    try:

        parameters = urllib.parse.urlencode({
            "q": text,
            "format": "jsonv2",
            "limit": 1,
            "countrycodes": "in"
        })

        url = (
            "https://nominatim.openstreetmap.org/search?"
            + parameters
        )

        request_object = urllib.request.Request(
            url,
            headers={
                "User-Agent":
                    "ResQFlow-PBL-Educational-Project/1.0",
                "Accept-Language": "en"
            }
        )

        with urllib.request.urlopen(
            request_object,
            timeout=7
        ) as response:

            data = json.loads(
                response.read().decode("utf-8")
            )

        if data:

            item = data[0]

            return {
                "lat": float(item["lat"]),
                "lng": float(item["lon"]),
                "display": item.get(
                    "display_name",
                    text
                ),
                "source": "OpenStreetMap"
            }

    except Exception as error:

        app.logger.warning(
            "Geocoding failed: %s",
            error
        )

    return local_result


# ============================================================
# 8. LOCATION SEARCH
# ============================================================

def search_locations(text, limit=5):

    text = str(text or "").strip()

    if len(text) < 2:
        return []

    try:

        safe_limit = min(
            max(int(limit), 1),
            8
        )

        parameters = urllib.parse.urlencode({
            "q": text,
            "format": "jsonv2",
            "limit": safe_limit,
            "countrycodes": "in",
            "addressdetails": 1
        })

        url = (
            "https://nominatim.openstreetmap.org/search?"
            + parameters
        )

        request_object = urllib.request.Request(
            url,
            headers={
                "User-Agent":
                    "ResQFlow-PBL-Educational-Project/1.0",
                "Accept-Language": "en"
            }
        )

        with urllib.request.urlopen(
            request_object,
            timeout=7
        ) as response:

            data = json.loads(
                response.read().decode("utf-8")
            )

        results = []

        for item in data:

            results.append({
                "lat": float(item["lat"]),
                "lng": float(item["lon"]),
                "display": item.get(
                    "display_name",
                    text
                ),
                "source": "OpenStreetMap"
            })

        if results:
            return results[:safe_limit]

    except Exception as error:

        app.logger.warning(
            "Location search failed: %s",
            error
        )

    # Local fallback
    results = []

    key = re.sub(
        r"\s+",
        " ",
        text.lower()
    ).strip()

    for name, coordinates in DEMO_LOCATIONS.items():

        if (
            key in name
            or
            name in key
        ):

            latitude, longitude = coordinates

            results.append({
                "lat": latitude,
                "lng": longitude,
                "display": name.title(),
                "source": "ResQFlow demo fallback"
            })

    return results[:limit]


# ============================================================
# 9. REVERSE GEOCODING
# ============================================================

def reverse_geocode(latitude, longitude):

    try:

        parameters = urllib.parse.urlencode({
            "lat": latitude,
            "lon": longitude,
            "format": "jsonv2",
            "zoom": 18
        })

        url = (
            "https://nominatim.openstreetmap.org/reverse?"
            + parameters
        )

        request_object = urllib.request.Request(
            url,
            headers={
                "User-Agent":
                    "ResQFlow-PBL-Educational-Project/1.0",
                "Accept-Language": "en"
            }
        )

        with urllib.request.urlopen(
            request_object,
            timeout=7
        ) as response:

            data = json.loads(
                response.read().decode("utf-8")
            )

        if data.get("display_name"):
            return data["display_name"]

    except Exception as error:

        app.logger.warning(
            "Reverse geocoding failed: %s",
            error
        )

    return f"{latitude:.5f}, {longitude:.5f}"


# ============================================================
# 10. LOCATION VALIDATION
# ============================================================

def get_selected_location(value):

    if isinstance(value, dict):

        try:

            latitude = float(
                value["lat"]
            )

            longitude = float(
                value["lng"]
            )

            display = str(
                value.get(
                    "display",
                    ""
                )
            ).strip()

            if not display:

                display = (
                    f"{latitude:.5f}, "
                    f"{longitude:.5f}"
                )

            if not (
                -90 <= latitude <= 90
                and
                -180 <= longitude <= 180
            ):

                return None

            return {
                "lat": latitude,
                "lng": longitude,
                "display": display,
                "source": value.get(
                    "source",
                    "Selected result"
                )
            }

        except (
            KeyError,
            TypeError,
            ValueError
        ):

            return None

    if isinstance(value, str):

        return geocode_location(value)

    return None


# ============================================================
# 11. DEMO ROUTES
# ============================================================

def create_demo_routes(start, end, vehicle="car"):

    start_lat = start["lat"]
    start_lng = start["lng"]

    end_lat = end["lat"]
    end_lng = end["lng"]

    direct_distance = calculate_distance(
        start_lat,
        start_lng,
        end_lat,
        end_lng
    )

    dx = end_lng - start_lng
    dy = end_lat - start_lat

    magnitude = max(
        math.sqrt(
            dx * dx + dy * dy
        ),
        0.000001
    )

    perpendicular_x = -dy / magnitude
    perpendicular_y = dx / magnitude

    offset = max(
        0.002,
        min(
            0.45,
            direct_distance / 111000 * 0.12
        )
    )

    middle_lat = (
        start_lat + end_lat
    ) / 2

    middle_lng = (
        start_lng + end_lng
    ) / 2

    middle_points = [

        (
            middle_lat
            + perpendicular_y * offset,

            middle_lng
            + perpendicular_x * offset
        ),

        (
            middle_lat
            - perpendicular_y * offset,

            middle_lng
            - perpendicular_x * offset
        )
    ]

    speed_kmh = {

        "car": 34,

        "bike": 28,

        "walk": 5

    }.get(
        vehicle,
        34
    )

    routes = []

    for middle_latitude, middle_longitude in middle_points:

        coordinates = [

            [start_lng, start_lat],

            [
                middle_longitude,
                middle_latitude
            ],

            [end_lng, end_lat]

        ]

        distance = 0

        for index in range(
            len(coordinates) - 1
        ):

            first = coordinates[index]

            second = coordinates[index + 1]

            distance += calculate_distance(
                first[1],
                first[0],
                second[1],
                second[0]
            )

        duration = (
            distance
            /
            (speed_kmh / 3.6)
        )

        routes.append({

            "distance": distance,

            "duration": duration,

            "geometry": {

                "type": "LineString",

                "coordinates": coordinates

            },

            "legs": [],

            "source": "DEMO_FALLBACK",

            "profile": vehicle

        })

    return routes


# ============================================================
# 12. OSRM ROUTING
# ============================================================

def get_osrm_routes(
    start,
    end,
    vehicle="car"
):

    routing_servers = {

        "car": (
            "https://router.project-osrm.org",
            "driving"
        ),

        "bike": (
            "https://routing.openstreetmap.de/"
            "routed-bike",
            "driving"
        ),

        "walk": (
            "https://routing.openstreetmap.de/"
            "routed-foot",
            "driving"
        )

    }

    server, profile = routing_servers.get(
        vehicle,
        routing_servers["car"]
    )

    coordinates = (
        f"{start['lng']},{start['lat']};"
        f"{end['lng']},{end['lat']}"
    )

    parameters = urllib.parse.urlencode({

        "alternatives": "true",

        "steps": "true",

        "overview": "full",

        "geometries": "geojson"

    })

    url = (
        f"{server}/route/v1/"
        f"{profile}/{coordinates}?"
        f"{parameters}"
    )

    try:

        request_object = urllib.request.Request(
            url,
            headers={
                "User-Agent":
                    "ResQFlow-PBL-Educational-Project/1.0"
            }
        )

        with urllib.request.urlopen(
            request_object,
            timeout=12
        ) as response:

            data = json.loads(
                response.read().decode("utf-8")
            )

        if (
            data.get("code") == "Ok"
            and
            data.get("routes")
        ):

            routes = data["routes"][:3]

            for route in routes:

                route["source"] = "OSRM"
                route["profile"] = vehicle

            return routes

    except Exception as error:

        app.logger.warning(
            "OSRM routing failed: %s",
            error
        )

    return create_demo_routes(
        start,
        end,
        vehicle
    )


# ============================================================
# 13. TRAFFIC SIMULATION
# ============================================================

def get_traffic_level(
    seed,
    segment_number
):

    value = int(
        hashlib.sha256(
            f"{seed}|segment|{segment_number}"
            .encode("utf-8")
        ).hexdigest()[:8],
        16
    ) % 100

    if value < 28:
        return "FREE"

    if value < 52:
        return "LOW"

    if value < 78:
        return "MEDIUM"

    return "HIGH"


def calculate_traffic_delay(
    traffic_level,
    duration
):

    percentages = {

        "FREE": 0.01,

        "LOW": 0.03,

        "MEDIUM": 0.10,

        "HIGH": 0.22

    }

    return (
        duration
        *
        percentages.get(
            traffic_level,
            0.10
        )
    )


# ============================================================
# 14. TRAFFIC SIGNALS
# ============================================================

def estimate_signals(
    distance_km,
    seed
):

    number = int(
        hashlib.md5(
            seed.encode("utf-8")
        ).hexdigest()[:6],
        16
    )

    signals = round(
        distance_km
        *
        (
            0.55
            +
            (number % 45) / 100
        )
    )

    return max(
        0,
        signals
    )


def calculate_signal_delay(
    signal_count,
    seed,
    emergency=False
):

    number = int(
        hashlib.sha1(
            seed.encode("utf-8")
        ).hexdigest()[:6],
        16
    )

    delay_per_signal = (
        10
        +
        number % 16
    )

    delay = (
        signal_count
        *
        delay_per_signal
    )

    if emergency:
        delay *= 0.65

    return delay


# ============================================================
# 15. TRAFFIC SEGMENTS
# ============================================================

def create_traffic_segments(
    route,
    seed
):

    coordinates = (
        route
        .get("geometry", {})
        .get("coordinates", [])
    )

    if len(coordinates) < 2:
        return []

    segments = []

    for index in range(
        len(coordinates) - 1
    ):

        segments.append({

            "coordinates": [
                coordinates[index],
                coordinates[index + 1]
            ],

            "level":
                get_traffic_level(
                    seed,
                    index
                )

        })

    return segments


# ============================================================
# 16. ROUTE ANALYSIS
# ============================================================

def analyze_route(
    route,
    route_index,
    start_text,
    destination_text,
    vehicle,
    mode,
    emergency_type
):

    distance_km = (
        float(
            route.get(
                "distance",
                0
            )
        )
        / 1000
    )

    base_duration = float(
        route.get(
            "duration",
            0
        )
    )

    seed = (
        f"{start_text}|"
        f"{destination_text}|"
        f"{vehicle}|"
        f"{route_index}|"
        f"{round(distance_km, 2)}"
    )

    traffic_segments = create_traffic_segments(
        route,
        seed
    )

    counts = {

        "FREE": 0,

        "LOW": 0,

        "MEDIUM": 0,

        "HIGH": 0

    }

    for segment in traffic_segments:

        level = segment["level"]

        if level in counts:

            counts[level] += 1

    traffic = max(
        counts,
        key=counts.get
    )

    signal_count = estimate_signals(
        distance_km,
        seed
    )

    traffic_delay = calculate_traffic_delay(
        traffic,
        base_duration
    )

    emergency_mode = mode in {

        "EMERGENCY",

        "VIP",

        "DISASTER"

    }

    signal_delay = calculate_signal_delay(
        signal_count,
        seed,
        emergency_mode
    )

    mode_weights = {

        "NORMAL": {

            "time": 1.15,

            "traffic": 1.0,

            "signal": 1.0,

            "distance": 10

        },

        "EMERGENCY": {

            "time": 1.0,

            "traffic": 0.8,

            "signal": 1.25,

            "distance": 8

        },

        "VIP": {

            "time": 0.95,

            "traffic": 0.7,

            "signal": 1.10,

            "distance": 7

        },

        "DISASTER": {

            "time": 0.90,

            "traffic": 0.65,

            "signal": 1.20,

            "distance": 6

        }

    }

    weights = mode_weights.get(
        mode,
        mode_weights["NORMAL"]
    )

    emergency_factor = {

        "Medical": 0.95,

        "Fire": 0.92,

        "Police": 0.96,

        "General": 1.0

    }.get(
        emergency_type,
        1.0
    )

    score = (

        base_duration
        * weights["time"]

        +

        traffic_delay
        * weights["traffic"]

        +

        signal_delay
        * weights["signal"]

        +

        distance_km
        * weights["distance"]

    )

    if mode != "NORMAL":

        score *= emergency_factor

    estimated_duration = (

        base_duration

        +

        traffic_delay

        +

        signal_delay

    )

    return {

        "index": route_index,

        "vehicle": vehicle,

        "distance_km":
            round(
                distance_km,
                2
            ),

        "base_duration_s":
            round(
                base_duration
            ),

        "estimated_duration_s":
            round(
                estimated_duration
            ),

        "traffic":
            traffic,

        "traffic_segments":
            traffic_segments,

        "traffic_counts":
            counts,

        "signal_count":
            signal_count,

        "traffic_delay_s":
            round(
                traffic_delay
            ),

        "signal_delay_s":
            round(
                signal_delay
            ),

        "score":
            round(
                score,
                2
            ),

        "status":
            "ALTERNATIVE",

        "blocked_by": [],

        "mode":
            mode

    }


# ============================================================
# 17. NORMALIZE MODE
# ============================================================

def normalize_mode(data):

    mode = str(
        data.get(
            "mode",
            ""
        )
    ).strip().upper()

    emergency = bool(
        data.get(
            "emergency",
            False
        )
    )

    allowed_modes = {

        "NORMAL",

        "EMERGENCY",

        "VIP",

        "DISASTER"

    }

    if mode not in allowed_modes:

        mode = (
            "EMERGENCY"
            if emergency
            else "NORMAL"
        )

    return mode


# ============================================================
# 18. HOME
# ============================================================

@app.get("/")
def home():

    return render_template(
        "index.html"
    )


# ============================================================
# 19. MANIFEST
# ============================================================

@app.get("/manifest.webmanifest")
def manifest():

    manifest_file = (
        BASE_DIR
        / "static"
        / "manifest.webmanifest"
    )

    if manifest_file.exists():

        return app.send_static_file(
            "manifest.webmanifest"
        )

    return jsonify({

        "name": "ResQFlow",

        "short_name": "ResQFlow",

        "start_url": "/",

        "display": "standalone"

    })


# ============================================================
# 20. REGISTER
# ============================================================

@app.post("/api/auth/register")
def register():

    data = request.get_json(
        silent=True
    ) or {}

    name = str(
        data.get(
            "name",
            ""
        )
    ).strip()

    email = str(
        data.get(
            "email",
            ""
        )
    ).strip().lower()

    password = str(
        data.get(
            "password",
            ""
        )
    )

    valid_email = re.match(
        r"^[^@\s]+@[^@\s]+\.[^@\s]+$",
        email
    )

    if (
        len(name) < 2
        or
        not valid_email
        or
        len(password) < 6
    ):

        return jsonify({

            "success": False,

            "message":
                "Enter a valid name, email and "
                "password of at least 6 characters."

        }), 400

    connection = get_database()

    try:

        cursor = connection.execute(

            """
            INSERT INTO users
            (
                name,
                email,
                password_hash,
                created_at
            )
            VALUES (?, ?, ?, ?)
            """,

            (
                name,

                email,

                generate_password_hash(
                    password
                ),

                current_time()
            )

        )

        connection.commit()

        user_id = cursor.lastrowid

    except sqlite3.IntegrityError:

        connection.close()

        return jsonify({

            "success": False,

            "message":
                "An account with this email already exists."

        }), 409

    finally:

        try:
            connection.close()
        except Exception:
            pass

    session.clear()

    session["user_id"] = user_id

    return jsonify({

        "success": True,

        "message":
            "Account created successfully.",

        "user":
            get_current_user()

    })


# ============================================================
# 21. LOGIN
# ============================================================

@app.post("/api/auth/login")
def login():

    data = request.get_json(
        silent=True
    ) or {}

    email = str(
        data.get(
            "email",
            ""
        )
    ).strip().lower()

    password = str(
        data.get(
            "password",
            ""
        )
    )

    connection = get_database()

    user = connection.execute(

        """
        SELECT *
        FROM users
        WHERE email = ?
        """,

        (email,)

    ).fetchone()

    connection.close()

    if (
        not user
        or
        not check_password_hash(
            user["password_hash"],
            password
        )
    ):

        return jsonify({

            "success": False,

            "message":
                "Email or password is incorrect."

        }), 401

    session.clear()

    session["user_id"] = user["id"]

    return jsonify({

        "success": True,

        "message":
            "Signed in successfully.",

        "user":
            get_current_user()

    })


# ============================================================
# 22. LOGOUT
# ============================================================

@app.post("/api/auth/logout")
def logout():

    session.clear()

    return jsonify({

        "success": True,

        "message":
            "Signed out successfully."

    })


# ============================================================
# 23. CURRENT USER
# ============================================================

@app.get("/api/auth/me")
def check_user():

    user = get_current_user()

    return jsonify({

        "success": True,

        "authenticated":
            user is not None,

        "user":
            user

    })


# ============================================================
# 24. HEALTH CHECK
# ============================================================

@app.get("/api/health")
def health_check():

    database_ok = False

    try:

        connection = get_database()

        connection.execute(
            "SELECT 1"
        )

        connection.close()

        database_ok = True

    except Exception as error:

        app.logger.warning(
            "Database health check failed: %s",
            error
        )

    return jsonify({

        "success": True,

        "backend":
            "online",

        "database":
            database_ok,

        "dijkstra":
            DSA_PROGRAM.exists(),

        "graph":
            GRAPH_FILE.exists(),

        "timestamp":
            current_time()

    })


# ============================================================
# 25. GEOCODE API
# ============================================================

@app.get("/api/geocode")
def geocode_api():

    query = request.args.get(
        "q",
        ""
    ).strip()

    if len(query) < 2:

        return jsonify({

            "success": True,

            "items": []

        })

    try:

        results = search_locations(
            query,
            5
        )

        return jsonify({

            "success": True,

            "items": results

        })

    except Exception as error:

        app.logger.exception(
            "Geocode API failed"
        )

        return jsonify({

            "success": False,

            "message":
                "Location search failed.",

            "detail":
                str(error)

        }), 502


# ============================================================
# 26. REVERSE GEOCODE API
# ============================================================

@app.get("/api/reverse-geocode")
def reverse_geocode_api():

    try:

        latitude = float(
            request.args.get(
                "lat"
            )
        )

        longitude = float(
            request.args.get(
                "lng"
            )
        )

    except (
        TypeError,
        ValueError
    ):

        return jsonify({

            "success": False,

            "message":
                "Invalid coordinates."

        }), 400

    if not (
        -90 <= latitude <= 90
        and
        -180 <= longitude <= 180
    ):

        return jsonify({

            "success": False,

            "message":
                "Coordinates are outside valid range."

        }), 400

    return jsonify({

        "success": True,

        "location": {

            "lat":
                latitude,

            "lng":
                longitude,

            "display":
                reverse_geocode(
                    latitude,
                    longitude
                ),

            "source":
                "Map selection"

        }

    })


# ============================================================
# 27. MAIN ROUTE API
# ============================================================

@app.post("/api/route")
def calculate_route():

    data = request.get_json(
        silent=True
    ) or {}

    start_value = (

        data.get(
            "start_location"
        )

        or

        data.get(
            "start"
        )

    )

    destination_value = (

        data.get(
            "destination_location"
        )

        or

        data.get(
            "destination"
        )

    )

    start = get_selected_location(
        start_value
    )

    destination = get_selected_location(
        destination_value
    )

    if not start or not destination:

        return jsonify({

            "success": False,

            "message":
                "Please select valid starting and "
                "destination locations."

        }), 400

    # Same location
    if (

        abs(
            start["lat"]
            - destination["lat"]
        ) < 0.0000001

        and

        abs(
            start["lng"]
            - destination["lng"]
        ) < 0.0000001

    ):

        return jsonify({

            "success": False,

            "message":
                "Start and destination cannot be the same."

        }), 400

    # Vehicle
    vehicle = str(
        data.get(
            "vehicle",
            "car"
        )
    ).lower().strip()

    if vehicle not in {

        "car",

        "bike",

        "walk",

        "best"

    }:

        vehicle = "car"

    # Mode
    mode = normalize_mode(
        data
    )

    # Emergency type
    emergency_type = str(

        data.get(

            "type",

            data.get(
                "emergency_type",
                "General"
            )

        )

    ).strip()

    if emergency_type not in {

        "Medical",

        "Fire",

        "Police",

        "General"

    }:

        emergency_type = "General"

    # Routing profiles
    if vehicle == "best":

        vehicles = [

            "car",

            "bike",

            "walk"

        ]

    else:

        vehicles = [
            vehicle
        ]

    combined_routes = []

    try:

        for selected_vehicle in vehicles:

            routes = get_osrm_routes(

                start,

                destination,

                selected_vehicle

            )

            for route_number, route in enumerate(routes):

                result = analyze_route(

                    route,

                    route_number,

                    start["display"],

                    destination["display"],

                    selected_vehicle,

                    mode,

                    emergency_type

                )

                route["profile"] = selected_vehicle

                combined_routes.append({

                    "route":
                        route,

                    "analysis":
                        result

                })

        # Sort best route first
        combined_routes.sort(

            key=lambda item:
                item["analysis"]["score"]

        )

        # Maximum 3 routes
        combined_routes = combined_routes[:3]

        routes = []

        analysis = []

        for index, item in enumerate(
            combined_routes
        ):

            route = item["route"]

            result = item["analysis"]

            result["index"] = index

            if index == 0:

                result["status"] = "RECOMMENDED"

            else:

                result["status"] = "ALTERNATIVE"

            routes.append(route)

            analysis.append(result)

        if not routes:

            return jsonify({

                "success": False,

                "message":
                    "No route could be generated."

            }), 502

        recommended_index = 0

        # Save history for logged-in user
        if session.get("user_id"):

            connection = get_database()

            connection.execute(

                """
                INSERT INTO route_history
                (
                    user_id,
                    start_text,
                    destination_text,
                    mode,
                    emergency_type,
                    recommended_index,
                    route_count,
                    created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,

                (
                    session["user_id"],

                    start["display"],

                    destination["display"],

                    mode,

                    emergency_type,

                    recommended_index,

                    len(routes),

                    current_time()

                )

            )

            connection.commit()

            connection.close()

        # Determine routing source
        live_routes = all(

            route.get("source") == "OSRM"

            for route in routes

        )

        return jsonify({

            "success": True,

            "start":
                start,

            "destination":
                destination,

            "routes":
                routes,

            "analysis":
                analysis,

            "recommended_index":
                recommended_index,

            "vehicle":
                vehicle,

            "mode":
                mode,

            "emergency":
                mode != "NORMAL",

            "emergency_type":
                emergency_type,

            "routing_source":

                "OSRM"

                if live_routes

                else

                "DEMO_FALLBACK",

            "message":
                "Routes analyzed successfully."

        })

    except Exception as error:

        app.logger.exception(
            "Route calculation failed"
        )

        return jsonify({

            "success": False,

            "message":
                "Route service could not complete the request.",

            "detail":
                str(error)

        }), 502


# ============================================================
# 28. ROUTE HISTORY
# ============================================================

@app.get("/api/history")
@login_required
def route_history():

    connection = get_database()

    rows = connection.execute(

        """
        SELECT
            id,
            start_text,
            destination_text,
            mode,
            emergency_type,
            recommended_index,
            route_count,
            created_at
        FROM route_history
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT 30
        """,

        (
            session["user_id"],
        )

    ).fetchall()

    connection.close()

    return jsonify({

        "success": True,

        "items": [

            dict(row)

            for row in rows

        ]

    })


# ============================================================
# 29. GPS SAVE
# ============================================================

@app.post("/api/gps")
def save_gps():

    data = request.get_json(
        silent=True
    ) or {}

    try:

        latitude = float(
            data["lat"]
        )

        longitude = float(
            data["lng"]
        )

        accuracy = float(
            data.get(
                "accuracy",
                0
            )
        )

        speed = data.get(
            "speed"
        )

        heading = data.get(
            "heading"
        )

        if speed is not None:
            speed = float(speed)

        if heading is not None:
            heading = float(heading)

    except (
        KeyError,
        TypeError,
        ValueError
    ):

        return jsonify({

            "success": False,

            "message":
                "Invalid GPS position."

        }), 400

    if not (

        -90 <= latitude <= 90

        and

        -180 <= longitude <= 180

    ):

        return jsonify({

            "success": False,

            "message":
                "Invalid GPS coordinates."

        }), 400

    connection = get_database()

    connection.execute(

        """
        INSERT INTO gps_positions
        (
            id,
            vehicle_id,
            latitude,
            longitude,
            accuracy,
            speed,
            heading,
            updated_at
        )
        VALUES
        (
            1,
            'RESQ-01',
            ?,
            ?,
            ?,
            ?,
            ?,
            ?
        )
        ON CONFLICT(id)
        DO UPDATE SET
            latitude = excluded.latitude,
            longitude = excluded.longitude,
            accuracy = excluded.accuracy,
            speed = excluded.speed,
            heading = excluded.heading,
            updated_at = excluded.updated_at
        """,

        (
            latitude,

            longitude,

            accuracy,

            speed,

            heading,

            current_time()

        )

    )

    connection.commit()

    connection.close()

    return jsonify({

        "success": True,

        "message":
            "GPS position updated."

    })


# ============================================================
# 30. GET GPS
# ============================================================

@app.get("/api/gps")
def get_gps():

    connection = get_database()

    row = connection.execute(

        """
        SELECT
            vehicle_id,
            latitude,
            longitude,
            accuracy,
            speed,
            heading,
            updated_at
        FROM gps_positions
        WHERE id = 1
        """

    ).fetchone()

    connection.close()

    if not row:

        return jsonify({

            "success": True,

            "position": None

        })

    return jsonify({

        "success": True,

        "position":
            dict(row)

    })


# ============================================================
# 31. DIJKSTRA API
# ============================================================

@app.post("/api/dijkstra")
@login_required
def run_dijkstra():

    if not DSA_PROGRAM.exists():

        return jsonify({

            "success": False,

            "message":
                "Dijkstra executable was not found."

        }), 400

    if not GRAPH_FILE.exists():

        return jsonify({

            "success": False,

            "message":
                "graph.csv was not found."

        }), 400

    data = request.get_json(
        silent=True
    ) or {}

    try:

        source = int(
            data.get(
                "source",
                0
            )
        )

        target = int(
            data.get(
                "target",
                5
            )
        )

    except (
        TypeError,
        ValueError
    ):

        return jsonify({

            "success": False,

            "message":
                "Source and target must be numbers."

        }), 400

    # Prevent obviously invalid values
    if source < 0 or target < 0:

        return jsonify({

            "success": False,

            "message":
                "Source and target cannot be negative."

        }), 400

    try:

        completed = subprocess.run(

            [

                str(DSA_PROGRAM),

                str(GRAPH_FILE),

                str(source),

                str(target)

            ],

            capture_output=True,

            text=True,

            timeout=5,

            cwd=str(BASE_DIR)

        )

        return jsonify({

            "success":
                completed.returncode == 0,

            "output":
                completed.stdout.strip(),

            "error":
                completed.stderr.strip(),

            "return_code":
                completed.returncode

        })

    except subprocess.TimeoutExpired:

        return jsonify({

            "success": False,

            "message":
                "Dijkstra calculation timed out."

        }), 504

    except Exception as error:

        app.logger.exception(
            "Dijkstra execution failed"
        )

        return jsonify({

            "success": False,

            "message":
                "Dijkstra module could not be executed.",

            "detail":
                str(error)

        }), 500


# ============================================================
# 32. 404 HANDLER
# ============================================================

@app.errorhandler(404)
def page_not_found(error):

    if request.path.startswith(
        "/api/"
    ):

        return jsonify({

            "success": False,

            "message":
                "API endpoint not found."

        }), 404

    try:

        return render_template(
            "index.html"
        ), 404

    except Exception:

        return (
            "ResQFlow page not found.",
            404
        )


# ============================================================
# 33. GENERAL ERROR
# ============================================================

@app.errorhandler(500)
def internal_server_error(error):

    app.logger.exception(
        "Internal server error"
    )

    if request.path.startswith(
        "/api/"
    ):

        return jsonify({

            "success": False,

            "message":
                "Internal server error."

        }), 500

    return (

        "ResQFlow encountered an internal server error.",

        500

    )


# ============================================================
# 34. START SERVER
# ============================================================

if __name__ == "__main__":

    initialize_database()

    # Cloud platforms provide PORT.
    # Local computer defaults to 5000.
    port = int(
        os.environ.get(
            "PORT",
            5000
        )
    )

    print()
    print("=" * 60)
    print("              ResQFlow Backend")
    print("=" * 60)
    print()
    print("Database :", DATABASE)
    print("Dijkstra :", DSA_PROGRAM)
    print("Graph    :", GRAPH_FILE)
    print()
    print("Server running on port:", port)
    print()
    print("=" * 60)

    app.run(

        host="0.0.0.0",

        port=port,

        debug=os.environ.get(
            "FLASK_DEBUG",
            "false"
        ).lower() == "true",

        use_reloader=False

    )