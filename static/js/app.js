
/* =========================================================
   ResQFlow - Main JavaScript File
   Emergency Route Optimization System

   This file controls:
   1. Leaflet map
   2. Route calculation
   3. Traffic and signal display
   4. Location search
   5. Login / Register
   6. Route history
   7. Settings
   8. Mobile and desktop navigation
   ========================================================= */


/* =========================================================
   GLOBAL VARIABLES
   ========================================================= */

let map;
let streetLayer;
let satelliteLayer;

let isSatellite = false;
let trafficVisible = true;
let signalsVisible = true;

let routeLayers = [];
let trafficLayers = [];
let signalMarkers = [];
let normalMarkers = [];

let selectedRoute = 0;
let currentSort = "best";

let mapSelectionTarget = null;

let authMode = "login";

let startLocation = null;
let endLocation = null;

let startSearchTimer;
let endSearchTimer;
let mapSearchTimer;


/* =========================================================
   SHORTCUT FOR GETTING HTML ELEMENTS
   ========================================================= */

function getElement(id) {
    return document.getElementById(id);
}


/* =========================================================
   SMALL HELPER FUNCTIONS
   ========================================================= */

/* Prevent HTML code from being inserted into the page */
function escapeHTML(value) {

    if (value === null || value === undefined) {
        return "";
    }

    return String(value).replace(/[&<>"']/g, function (character) {

        const characters = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        };

        return characters[character];
    });
}


/* Convert seconds into readable time */
function formatTime(seconds) {

    seconds = Number(seconds || 0);

    if (seconds < 60) {
        return Math.max(1, Math.round(seconds)) + " sec";
    }

    return Math.round(seconds / 60) + " min";
}


/* Show or hide message box */
function showMessage(message, isError = false) {

    const messageBox = getElement("message");

    if (!message) {

        messageBox.classList.add("hidden");
        messageBox.classList.remove("error");
        messageBox.textContent = "";

        return;
    }

    messageBox.textContent = message;

    if (isError) {
        messageBox.classList.add("error");
    } else {
        messageBox.classList.remove("error");
    }

    messageBox.classList.remove("hidden");
}


/* Remove message after some time */
function hideMessageAfterTime(time = 2500) {

    setTimeout(function () {
        showMessage("");
    }, time);
}


/* =========================================================
   LEAFLET ICON
   ========================================================= */

function createMapIcon(className) {

    return L.divIcon({
        className: "",
        html: `<div class="${className}"></div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });
}


/* =========================================================
   MAP INITIALIZATION
   ========================================================= */

function initializeMap() {

    /* Create Leaflet map */
    map = L.map("map", {
        zoomControl: false,
        preferCanvas: true,
        attributionControl: true
    });

    /* Starting position - Dehradun */
    map.setView([30.3165, 78.0322], 12);


    /* ---------------- Street Map ---------------- */

    streetLayer = L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
            maxZoom: 19,
            attribution: "&copy; OpenStreetMap contributors"
        }
    );

    streetLayer.addTo(map);


    /* ---------------- Satellite Map ---------------- */

    satelliteLayer = L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {
            maxZoom: 19,
            attribution: "Tiles &copy; Esri"
        }
    );


    /* ---------------- Map Click ---------------- */

    map.on("click", function (event) {

        if (!mapSelectionTarget) {
            return;
        }

        const target = mapSelectionTarget;

        mapSelectionTarget = null;

        map.getContainer().style.cursor = "";

        const message = target === "start"
            ? "starting point"
            : "destination";

        showMessage("Reading " + message + "...");

        reverseGeocodeMapLocation(
            event.latlng.lat,
            event.latlng.lng,
            target
        );
    });
}


/* =========================================================
   REVERSE GEOCODING MAP LOCATION
   ========================================================= */

async function reverseGeocodeMapLocation(latitude, longitude, target) {

    try {

        const response = await fetch(
            `/api/reverse-geocode?lat=${latitude}&lng=${longitude}`
        );

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(
                data.message || "Could not find this location."
            );
        }

        setLocation(target, data.location);

        map.setView(
            [latitude, longitude],
            Math.max(map.getZoom(), 15)
        );

        const locationName =
            target === "start"
                ? "Starting point"
                : "Destination";

        showMessage(locationName + " selected.");

        hideMessageAfterTime();

    } catch (error) {

        showMessage(
            error.message || "Could not select this location.",
            true
        );
    }
}


/* =========================================================
   CLEAR ALL MAP LAYERS
   ========================================================= */

function clearMapLayers() {

    routeLayers.forEach(function (layer) {
        map.removeLayer(layer);
    });

    trafficLayers.forEach(function (layer) {
        map.removeLayer(layer);
    });

    signalMarkers.forEach(function (marker) {
        map.removeLayer(marker);
    });

    normalMarkers.forEach(function (marker) {
        map.removeLayer(marker);
    });


    routeLayers = [];
    trafficLayers = [];
    signalMarkers = [];
    normalMarkers = [];
}


/* =========================================================
   CLEAR CURRENT ROUTE
   ========================================================= */

function clearRoute() {

    clearMapLayers();

    window.lastRouteData = null;

    selectedRoute = 0;

    getElement("routeResults").classList.add("hidden");
    getElement("detailSheet").classList.add("hidden");

    getElement("routingSource").textContent =
        "Ready for a route";

    showMessage("");
}


/* =========================================================
   TRAFFIC COLORS
   ========================================================= */

function getTrafficColor(level) {

    if (level === "HIGH") {
        return "#df3f45";
    }

    if (level === "MEDIUM") {
        return "#e4a41b";
    }

    if (level === "LOW") {
        return "#1aa064";
    }

    return "#176fe5";
}


/* =========================================================
   ROUTE COLOR
   ========================================================= */

function getRouteColor(routeAnalysis) {

    if (routeAnalysis.status === "RECOMMENDED") {
        return "#188b57";
    }

    return "#176fe5";
}


/* =========================================================
   DRAW START / END MARKER
   ========================================================= */

function drawMarker(latitude, longitude, type, label) {

    const marker = L.marker(
        [latitude, longitude],
        {
            icon: createMapIcon(type + "-marker"),
            zIndexOffset: 700
        }
    ).addTo(map);


    if (label) {

        marker.bindTooltip(label, {
            direction: "top",
            offset: [0, -9]
        });
    }


    normalMarkers.push(marker);

    return marker;
}


/* =========================================================
   CREATE TRAFFIC SIGNAL POSITIONS
   ========================================================= */

function createSignalPositions(coordinates, numberOfSignals) {

    if (!coordinates || coordinates.length < 2) {
        return [];
    }

    if (!numberOfSignals) {
        return [];
    }


    const points = [];

    const signalCount = Math.min(
        Number(numberOfSignals),
        16
    );


    const step =
        (coordinates.length - 1) /
        (signalCount + 1);


    for (let i = 1; i <= signalCount; i++) {

        const position = i * step;

        const firstIndex = Math.floor(position);

        const secondIndex =
            Math.min(
                coordinates.length - 1,
                firstIndex + 1
            );


        const percentage =
            position - firstIndex;


        const firstPoint =
            coordinates[firstIndex];

        const secondPoint =
            coordinates[secondIndex];


        const longitude =
            firstPoint[0] +
            (secondPoint[0] - firstPoint[0]) *
            percentage;


        const latitude =
            firstPoint[1] +
            (secondPoint[1] - firstPoint[1]) *
            percentage;


        points.push([latitude, longitude]);
    }


    return points;
}


/* =========================================================
   DRAW ALL ROUTES ON MAP
   ========================================================= */

function drawRoutes(routes, analysis) {

    clearMapLayers();

    const allCoordinates = [];


    routes.forEach(function (route, index) {

        const routeInfo = analysis[index];


        /* Convert coordinates:
           API gives [longitude, latitude]
           Leaflet needs [latitude, longitude]
        */

        const coordinates =
            route.geometry.coordinates.map(function (point) {

                return [
                    point[1],
                    point[0]
                ];
            });


        allCoordinates.push(...coordinates);


        /* ---------------- Main Route ---------------- */

        const routeLine = L.polyline(
            coordinates,
            {
                color: getRouteColor(routeInfo),

                weight:
                    routeInfo.status === "RECOMMENDED"
                        ? 8
                        : 6,

                opacity:
                    index === selectedRoute
                        ? 0.92
                        : 0.32,

                lineCap: "round",
                lineJoin: "round"
            }
        ).addTo(map);


        routeLine.routeIndex = index;


        routeLine.on("click", function () {
            selectRoute(index);
        });


        routeLayers.push(routeLine);


        /* ---------------- Traffic Sections ---------------- */

        if (routeInfo.traffic_segments) {

            routeInfo.traffic_segments.forEach(
                function (segment) {

                    const trafficPoints =
                        segment.coordinates.map(
                            function (point) {

                                return [
                                    point[1],
                                    point[0]
                                ];
                            }
                        );


                    const trafficLine = L.polyline(
                        trafficPoints,
                        {
                            color: getTrafficColor(
                                segment.level
                            ),

                            weight:
                                index === selectedRoute
                                    ? 7
                                    : 5,

                            opacity:
                                trafficVisible
                                    ? (
                                        index === selectedRoute
                                            ? 0.95
                                            : 0.35
                                    )
                                    : 0,

                            lineCap: "round",
                            lineJoin: "round"
                        }
                    ).addTo(map);


                    trafficLine.routeIndex = index;


                    trafficLine.on(
                        "click",
                        function () {
                            selectRoute(index);
                        }
                    );


                    trafficLayers.push(
                        trafficLine
                    );
                }
            );
        }


        /* ---------------- Traffic Signals ---------------- */

        if (signalsVisible) {

            const signalPoints =
                createSignalPositions(
                    route.geometry.coordinates,
                    routeInfo.signal_count
                );


            signalPoints.forEach(
                function (point, signalIndex) {

                    const averageDelay =
                        routeInfo.signal_count > 0
                            ? (
                                routeInfo.signal_delay_s /
                                routeInfo.signal_count
                            )
                            : 0;


                    const marker = L.marker(
                        point,
                        {
                            icon:
                                createMapIcon(
                                    "signal-marker"
                                ),
                            zIndexOffset: 900
                        }
                    );


                    marker.bindTooltip(
                        "Signal " +
                        (signalIndex + 1) +
                        " · Estimated delay " +
                        Math.max(
                            4,
                            Math.round(averageDelay)
                        ) +
                        " sec",
                        {
                            direction: "top"
                        }
                    );


                    marker.addTo(map);

                    signalMarkers.push(marker);
                }
            );
        }
    });


    /* ---------------- Fit Map To Routes ---------------- */

    if (allCoordinates.length > 0) {

        const isMobile =
            window.innerWidth <= 800;


        let leftPadding;
        let topPadding;
        let rightPadding;
        let bottomPadding;


        if (isMobile) {

            leftPadding = 22;
            topPadding = 150;
            rightPadding = 22;
            bottomPadding = 190;

        } else {

            leftPadding =
                window.innerWidth <= 1200
                    ? 390
                    : 430;

            topPadding = 115;
            rightPadding = 300;
            bottomPadding = 120;
        }


        map.fitBounds(
            allCoordinates,
            {
                paddingTopLeft: [
                    leftPadding,
                    topPadding
                ],

                paddingBottomRight: [
                    rightPadding,
                    bottomPadding
                ],

                maxZoom: 16
            }
        );
    }


    /* Draw start marker */

    if (window.lastRouteData?.start) {

        drawMarker(
            window.lastRouteData.start.lat,
            window.lastRouteData.start.lng,
            "start",
            "Start"
        );
    }


    /* Draw destination marker */

    if (window.lastRouteData?.destination) {

        drawMarker(
            window.lastRouteData.destination.lat,
            window.lastRouteData.destination.lng,
            "end",
            "Destination"
        );
    }
}


/* =========================================================
   ROUTE SCORE TEXT
   ========================================================= */

function getRouteScoreText(route) {

    if (route.status === "RECOMMENDED") {
        return "Best overall";
    }

    if (route.traffic === "HIGH") {
        return "Traffic-aware alternative";
    }

    return "Good alternative";
}


/* =========================================================
   DISPLAY ROUTE CARDS
   ========================================================= */

function displayRouteCards(analysis) {

    const routeCards = getElement("routeCards");

    let html = "";


    analysis.forEach(function (route, index) {

        const isRecommended =
            route.status === "RECOMMENDED";


        const title =
            isRecommended
                ? "Recommended route"
                : "Alternative route " +
                  String.fromCharCode(65 + index);


        html += `
            <article
                class="route-card
                ${isRecommended ? "recommended" : ""}
                ${index === selectedRoute ? "selected" : ""}"
                data-route="${index}"
            >

                <div class="route-top">

                    <div class="route-title">
                        ${title}
                    </div>

                    <span class="route-badge
                        ${isRecommended ? "green" : "blue"}">

                        ${isRecommended
                            ? "BEST"
                            : "OPTION"}

                    </span>

                </div>


                <div class="route-meta">

                    <span>
                        <strong>
                            ${escapeHTML(route.distance_km)} km
                        </strong>
                    </span>

                    <span>
                        <strong>
                            ${formatTime(
                                route.estimated_duration_s
                            )}
                        </strong>
                    </span>

                    <span>
                        ${escapeHTML(
                            route.traffic || "Low"
                        )}
                        traffic
                    </span>

                </div>


                <div class="route-card-footer">

                    <span class="route-score">

                        ${getRouteScoreText(route)}

                        ·

                        ${route.signal_count || 0}
                        signals

                    </span>


                    <button
                        class="route-start"
                        type="button"
                        data-start-route="${index}"
                    >
                        View route
                    </button>

                </div>

            </article>
        `;
    });


    routeCards.innerHTML = html;


    /* Route card click */

    document
        .querySelectorAll(".route-card")
        .forEach(function (card) {

            card.addEventListener(
                "click",
                function (event) {

                    if (
                        !event.target.closest(
                            "[data-start-route]"
                        )
                    ) {

                        selectRoute(
                            Number(card.dataset.route)
                        );
                    }
                }
            );
        });


    /* View route buttons */

    document
        .querySelectorAll("[data-start-route]")
        .forEach(function (button) {

            button.addEventListener(
                "click",
                function (event) {

                    event.stopPropagation();

                    selectRoute(
                        Number(
                            button.dataset.startRoute
                        )
                    );
                }
            );
        });
}


/* =========================================================
   CREATE TURN-BY-TURN DIRECTIONS
   ========================================================= */

function updateDirections(route) {

    const steps = [];


    if (route.legs) {

        route.legs.forEach(function (leg) {

            if (!leg.steps) {
                return;
            }


            leg.steps.forEach(function (step) {

                let instruction;


                if (
                    step.maneuver &&
                    step.maneuver.type === "depart"
                ) {

                    instruction =
                        "Start on the selected road";

                } else if (
                    step.maneuver &&
                    step.maneuver.type === "arrive"
                ) {

                    instruction =
                        "Arrive at your destination";

                } else {

                    let direction = "";

                    if (
                        step.maneuver &&
                        step.maneuver.modifier
                    ) {

                        direction =
                            step.maneuver.modifier
                                .replace("-", " ") +
                            " ";
                    }


                    if (step.name) {

                        instruction =
                            direction +
                            "onto " +
                            step.name;

                    } else {

                        instruction =
                            direction +
                            "Continue on the route";
                    }
                }


                steps.push({
                    instruction: instruction,
                    distance: step.distance || 0
                });
            });
        });
    }


    /* If API does not return steps */

    if (steps.length === 0) {

        steps.push({
            instruction:
                "Follow the highlighted route to your destination",

            distance:
                route.distance || 0
        });
    }


    const visibleSteps =
        steps.slice(0, 7);


    getElement("directionCount").textContent =
        visibleSteps.length +
        (
            visibleSteps.length === 1
                ? " step"
                : " steps"
        );


    let html = "";


    visibleSteps.forEach(
        function (step, index) {

            let distanceText;


            if (step.distance >= 1000) {

                distanceText =
                    (step.distance / 1000)
                        .toFixed(1) +
                    " km";

            } else {

                distanceText =
                    Math.max(
                        10,
                        Math.round(step.distance)
                    ) +
                    " m";
            }


            html += `
                <div>

                    <i>${index + 1}</i>

                    <span>
                        ${escapeHTML(
                            step.instruction
                        )}
                    </span>

                    <small>
                        ${distanceText}
                    </small>

                </div>
            `;
        }
    );


    getElement("turnList").innerHTML = html;
}


/* =========================================================
   SELECT A ROUTE
   ========================================================= */

function selectRoute(index) {

    if (
        !window.lastRouteData ||
        !window.lastRouteData.analysis[index]
    ) {
        return;
    }


    selectedRoute = index;


    const route =
        window.lastRouteData.analysis[index];


    /* Update selected route card */

    document
        .querySelectorAll(".route-card")
        .forEach(function (card, cardIndex) {

            card.classList.toggle(
                "selected",
                cardIndex === index
            );
        });


    /* Update main route lines */

    routeLayers.forEach(function (layer) {

        if (layer.routeIndex === index) {

            layer.setStyle({
                weight: 8,
                opacity: 0.92
            });

        } else {

            layer.setStyle({
                weight: 6,
                opacity: 0.28
            });
        }
    });


    /* Update traffic lines */

    trafficLayers.forEach(function (layer) {

        if (!trafficVisible) {

            layer.setStyle({
                opacity: 0
            });

            return;
        }


        if (layer.routeIndex === index) {

            layer.setStyle({
                weight: 7,
                opacity: 0.95
            });

        } else {

            layer.setStyle({
                weight: 5,
                opacity: 0.30
            });
        }
    });


    /* ---------------- Detail Panel ---------------- */

    const title =
        route.status === "RECOMMENDED"
            ? "Recommended route"
            : "Alternative route " +
              String.fromCharCode(65 + index);


    getElement("detailTitle").textContent =
        title;


    getElement("detailSubtitle").textContent =
        (
            route.vehicle || "car"
        ).toUpperCase() +
        " · Traffic-aware route analysis";


    const badge =
        getElement("detailBadge");


    badge.textContent =
        route.status === "RECOMMENDED"
            ? "RECOMMENDED"
            : "ALTERNATIVE";


    badge.className =
        "route-badge " +
        (
            route.status === "RECOMMENDED"
                ? "green"
                : "blue"
        );


    getElement("sumDistance").textContent =
        route.distance_km + " km";


    getElement("sumTime").textContent =
        formatTime(
            route.estimated_duration_s
        );


    getElement("sumTraffic").textContent =
        route.traffic || "FREE";


    getElement("sumSignals").textContent =
        route.signal_count || 0;


    getElement("sumDelay").textContent =
        formatTime(
            route.signal_delay_s || 0
        );


    /* ---------------- Analysis Factors ---------------- */

    const trafficCounts =
        route.traffic_counts || {};


    const factors = [

        [
            "Traffic level",
            route.traffic || "FREE"
        ],

        [
            "Base travel time",
            formatTime(
                route.base_duration_s || 0
            )
        ],

        [
            "Traffic delay",
            formatTime(
                route.traffic_delay_s || 0
            )
        ],

        [
            "Signal delay",
            formatTime(
                route.signal_delay_s || 0
            )
        ],

        [
            "Traffic segments",
            (trafficCounts.HIGH || 0) +
            " high · " +
            (trafficCounts.MEDIUM || 0) +
            " medium"
        ]
    ];


    let factorHTML = "";


    factors.forEach(function (factor) {

        factorHTML += `
            <div class="factor">

                <span>
                    ${escapeHTML(factor[0])}
                </span>

                <b>
                    ${escapeHTML(factor[1])}
                </b>

            </div>
        `;
    });


    getElement("factorRows").innerHTML =
        factorHTML;


    getElement("signalNote").textContent =
        (
            route.signal_count || 0
        ) +
        " signal points are estimated along this route.";


    /* Turn-by-turn directions */

    updateDirections(
        window.lastRouteData.routes[index]
    );


    /* Show detail panel */

    getElement("detailSheet")
        .classList.remove("hidden");


    /* On mobile hide route cards */

    if (window.innerWidth <= 800) {

        getElement("routeResults")
            .classList.add("hidden");
    }
}


/* =========================================================
   LOCATION SELECTION
   ========================================================= */

function setLocation(target, location) {

    const locationData = {

        lat: Number(location.lat),

        lng: Number(location.lng),

        display: location.display,

        source:
            location.source ||
            "Selected location"
    };


    if (target === "start") {

        startLocation = locationData;

    } else {

        endLocation = locationData;
    }


    const input =
        target === "start"
            ? getElement("startInput")
            : getElement("endInput");


    input.value =
        location.display;


    input.classList.add(
        "location-selected"
    );


    getElement(
        target + "Suggestions"
    ).classList.add("hidden");
}


/* =========================================================
   CLEAR SELECTED LOCATION
   ========================================================= */

function clearSelectedLocation(target) {

    if (target === "start") {

        startLocation = null;

    } else {

        endLocation = null;
    }


    const input =
        target === "start"
            ? getElement("startInput")
            : getElement("endInput");


    input.classList.remove(
        "location-selected"
    );
}


/* =========================================================
   SHOW LOCATION SUGGESTIONS
   ========================================================= */

function showSuggestions(target, locations) {

    const suggestionBox =
        getElement(target + "Suggestions");


    if (!locations.length) {

        suggestionBox.innerHTML =
            `<div class="suggestion-empty">
                No matching locations found.
            </div>`;

        suggestionBox.classList.remove(
            "hidden"
        );

        return;
    }


    let html = "";


    locations
        .slice(0, 5)
        .forEach(function (location, index) {

            const title =
                (location.display || "")
                    .split(",")[0];


            html += `
                <button
                    class="suggestion-item"
                    type="button"
                    data-suggestion="${index}"
                >

                    <span class="suggestion-pin">
                        ●
                    </span>

                    <span>

                        <b>
                            ${escapeHTML(title)}
                        </b>

                        <small>
                            ${escapeHTML(
                                location.display
                            )}
                        </small>

                    </span>

                </button>
            `;
        });


    suggestionBox.innerHTML = html;


    suggestionBox.classList.remove(
        "hidden"
    );


    suggestionBox
        .querySelectorAll("[data-suggestion]")
        .forEach(function (button) {

            button.addEventListener(
                "click",
                function () {

                    const index =
                        Number(
                            button.dataset.suggestion
                        );


                    setLocation(
                        target,
                        locations[index]
                    );
                }
            );
        });
}


/* =========================================================
   SEARCH LOCATION FROM BACKEND
   ========================================================= */

async function searchLocation(target, value) {

    value = value.trim();


    if (value.length < 2) {

        getElement(
            target + "Suggestions"
        ).classList.add("hidden");

        return;
    }


    try {

        const response = await fetch(
            `/api/geocode?q=${encodeURIComponent(value)}`
        );


        const data =
            await response.json();


        if (data.success) {

            showSuggestions(
                target,
                data.items || []
            );
        }

    } catch (error) {

        console.log(
            "Location search error:",
            error
        );
    }
}


/* =========================================================
   LOCATION INPUT EVENTS
   ========================================================= */

function setupLocationInput(target) {

    const input =
        target === "start"
            ? getElement("startInput")
            : getElement("endInput");


    input.addEventListener(
        "input",
        function () {

            clearSelectedLocation(target);


            if (target === "start") {

                clearTimeout(startSearchTimer);

                startSearchTimer =
                    setTimeout(
                        function () {

                            searchLocation(
                                target,
                                input.value
                            );

                        },
                        300
                    );

            } else {

                clearTimeout(endSearchTimer);

                endSearchTimer =
                    setTimeout(
                        function () {

                            searchLocation(
                                target,
                                input.value
                            );

                        },
                        300
                    );
            }
        }
    );


    input.addEventListener(
        "focus",
        function () {

            if (
                !(
                    target === "start"
                        ? startLocation
                        : endLocation
                ) &&
                input.value.trim().length >= 2
            ) {

                searchLocation(
                    target,
                    input.value
                );
            }
        }
    );
}


/* =========================================================
   SELECT LOCATION BY CLICKING MAP
   ========================================================= */

function chooseLocationFromMap(target) {

    mapSelectionTarget = target;

    map.getContainer().style.cursor =
        "crosshair";


    const place =
        target === "start"
            ? "starting point"
            : "destination";


    showMessage(
        "Click the map to choose the " +
        place +
        "."
    );
}


/* =========================================================
   CALCULATE ROUTE
   ========================================================= */

async function calculateRoute(event) {

    event.preventDefault();


    /* Check start location */

    if (!startLocation) {

        showMessage(
            "Please select a starting location.",
            true
        );

        return;
    }


    /* Check destination */

    if (!endLocation) {

        showMessage(
            "Please select a destination.",
            true
        );

        return;
    }


    /* Check same location */

    if (
        startLocation.lat === endLocation.lat &&
        startLocation.lng === endLocation.lng
    ) {

        showMessage(
            "Start and destination cannot be the same.",
            true
        );

        return;
    }


    const routeButton =
        getElement("routeBtn");


    routeButton.disabled = true;


    routeButton.innerHTML =
        `<span class="button-spinner"></span>
         <span>Finding routes...</span>`;


    getElement("routingSource").textContent =
        "Comparing available routes...";


    showMessage(
        "Calculating the safest available route..."
    );


    try {

        const mode =
            getElement("mode").value;


        const vehicle =
            getElement("vehicle").value;


        const emergencyMode =
            (
                mode === "emergency" ||
                mode === "vip" ||
                mode === "disaster"
            );


        const emergencyType =
            mode === "disaster"
                ? "General"
                : getElement(
                    "emergencyType"
                ).value;


        const requestData = {

            start_location:
                startLocation,

            destination_location:
                endLocation,

            vehicle:
                vehicle,

            emergency:
                emergencyMode,

            type:
                emergencyType
        };


        const response =
            await fetch(
                "/api/route",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify(
                            requestData
                        )
                }
            );


        const data =
            await response.json();


        if (
            !response.ok ||
            !data.success
        ) {

            throw new Error(
                data.message ||
                "Route calculation failed."
            );
        }


        /* Save route data */

        window.lastRouteData =
            data;


        selectedRoute =
            data.recommended_index || 0;


        /* Draw route on map */

        drawRoutes(
            data.routes,
            data.analysis
        );


        /* Show route cards */

        displayRouteCards(
            data.analysis
        );


        /* Show selected route */

        selectRoute(
            selectedRoute
        );


        /* Show results */

        getElement("routeResults")
            .classList.remove("hidden");


        getElement("resultsTitle")
            .textContent =
            data.analysis.length +
            " route" +
            (
                data.analysis.length === 1
                    ? ""
                    : "s"
            ) +
            " found";


        const modeName =
            mode.charAt(0).toUpperCase() +
            mode.slice(1);


        const vehicleName =
            data.vehicle === "best"
                ? "Best route comparison"
                : data.vehicle.toUpperCase();


        getElement("resultsSubtitle")
            .textContent =
            vehicleName +
            " · " +
            modeName +
            " mode";


        /* Routing source */

        if (data.routing_source === "OSRM") {

            getElement("routingSource")
                .textContent =
                "OpenStreetMap routing";

        } else {

            getElement("routingSource")
                .textContent =
                "Demo routing fallback";
        }


        showMessage(
            "Routes are ready. Select a route to inspect its details."
        );


        hideMessageAfterTime();

    } catch (error) {

        console.error(
            "Route error:",
            error
        );


        showMessage(
            error.message ||
            "Route service is unavailable.",
            true
        );


        getElement("routingSource")
            .textContent =
            "Route service unavailable";

    } finally {

        routeButton.disabled = false;


        routeButton.innerHTML =
            `<svg viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="6.5"/>
                <path d="m16 16 5 5"/>
            </svg>
            <span>Find routes</span>`;
    }
}


/* =========================================================
   TRAFFIC TOGGLE
   ========================================================= */

function toggleTraffic() {

    trafficVisible =
        !trafficVisible;


    getElement("trafficToggle")
        .classList.toggle(
            "active",
            trafficVisible
        );


    trafficLayers.forEach(
        function (layer) {

            if (!trafficVisible) {

                layer.setStyle({
                    opacity: 0
                });

                return;
            }


            layer.setStyle({

                opacity:
                    layer.routeIndex === selectedRoute
                        ? 0.95
                        : 0.30
            });
        }
    );


    showMessage(
        trafficVisible
            ? "Traffic layer is on."
            : "Traffic layer is off."
    );


    hideMessageAfterTime();
}


/* =========================================================
   SIGNAL TOGGLE
   ========================================================= */

function toggleSignals() {

    signalsVisible =
        !signalsVisible;


    getElement("signalsToggle")
        .classList.toggle(
            "active",
            signalsVisible
        );


    if (window.lastRouteData) {

        drawRoutes(
            window.lastRouteData.routes,
            window.lastRouteData.analysis
        );


        selectRoute(
            selectedRoute
        );

    } else {

        showMessage(
            signalsVisible
                ? "Signal points will appear on the next route."
                : "Signal points are hidden."
        );
    }


    hideMessageAfterTime();
}


/* =========================================================
   ROUTE LINE TOGGLE
   ========================================================= */

function toggleRouteLines() {

    let routeIsVisible =
        routeLayers.some(
            function (layer) {
                return layer.options.opacity > 0;
            }
        );


    routeLayers.forEach(
        function (layer) {

            if (routeIsVisible) {

                layer.setStyle({
                    opacity: 0
                });

            } else {

                layer.setStyle({

                    opacity:
                        layer.routeIndex === selectedRoute
                            ? 0.92
                            : 0.28
                });
            }
        }
    );


    getElement("routeToggle")
        .classList.toggle(
            "active",
            !routeIsVisible
        );


    showMessage(
        routeIsVisible
            ? "Route lines are hidden."
            : "Route lines are visible."
    );


    hideMessageAfterTime();
}


/* =========================================================
   SATELLITE / STREET MAP TOGGLE
   ========================================================= */

function toggleSatellite() {

    if (isSatellite) {

        map.removeLayer(
            satelliteLayer
        );

        streetLayer.addTo(map);

        isSatellite = false;

    } else {

        map.removeLayer(
            streetLayer
        );

        satelliteLayer.addTo(map);

        isSatellite = true;
    }


    const satelliteButton =
        getElement("satelliteToggle");


    satelliteButton.classList.toggle(
        "active",
        isSatellite
    );


    satelliteButton.setAttribute(
        "aria-pressed",
        isSatellite
            ? "true"
            : "false"
    );


    satelliteButton
        .querySelector(
            ".map-style-copy strong"
        )
        .textContent =
        isSatellite
            ? "Map"
            : "Satellite";


    satelliteButton
        .querySelector(
            ".map-style-copy span"
        )
        .textContent =
        isSatellite
            ? "Street view"
            : "Map view";
}


/* =========================================================
   GET CURRENT LOCATION
   ========================================================= */

function getCurrentLocation() {

    if (!navigator.geolocation) {

        showMessage(
            "This browser does not support location services.",
            true
        );

        return;
    }


    showMessage(
        "Getting your current location..."
    );


    navigator.geolocation.getCurrentPosition(

        async function (position) {

            const latitude =
                position.coords.latitude;


            const longitude =
                position.coords.longitude;


            const accuracy =
                position.coords.accuracy;


            let locationName =
                latitude.toFixed(5) +
                ", " +
                longitude.toFixed(5);


            /* Try to get actual address */

            try {

                const response =
                    await fetch(
                        `/api/reverse-geocode?lat=${latitude}&lng=${longitude}`
                    );


                const data =
                    await response.json();


                if (
                    data.location &&
                    data.location.display
                ) {

                    locationName =
                        data.location.display;
                }

            } catch (error) {

                console.log(
                    "Address lookup failed"
                );
            }


            /* Set as starting location */

            setLocation(
                "start",
                {
                    lat: latitude,
                    lng: longitude,
                    display: locationName,
                    source: "Current location"
                }
            );


            /* Show marker */

            drawMarker(
                latitude,
                longitude,
                "user",
                "Your location"
            );


            /* Move map */

            map.setView(
                [latitude, longitude],
                15
            );


            /* Save GPS information */

            try {

                await fetch(
                    "/api/gps",
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body:
                            JSON.stringify({
                                lat: latitude,
                                lng: longitude,
                                accuracy: accuracy
                            })
                    }
                );

            } catch (error) {

                console.log(
                    "GPS save failed"
                );
            }


            showMessage(
                "Your current location is now the starting point."
            );


            hideMessageAfterTime();
        },


        function (error) {

            if (error.code === 1) {

                showMessage(
                    "Location permission was not granted.",
                    true
                );

            } else {

                showMessage(
                    "Could not get your current location.",
                    true
                );
            }
        },


        {
            enableHighAccuracy: true,
            timeout: 10000
        }
    );
}


/* =========================================================
   SWAP START AND DESTINATION
   ========================================================= */

function swapLocations() {

    const oldStart =
        startLocation;


    const oldEnd =
        endLocation;


    const startText =
        getElement("startInput").value;


    const endText =
        getElement("endInput").value;


    /* Swap variables */

    startLocation =
        oldEnd;


    endLocation =
        oldStart;


    /* Swap input text */

    getElement("startInput").value =
        endText;


    getElement("endInput").value =
        startText;


    /* Update selected styles */

    getElement("startInput")
        .classList.toggle(
            "location-selected",
            Boolean(oldEnd)
        );


    getElement("endInput")
        .classList.toggle(
            "location-selected",
            Boolean(oldStart)
        );
}


/* =========================================================
   MAP SEARCH
   ========================================================= */

async function searchMapPlace(value) {

    value = value.trim();


    if (value.length < 2) {

        getElement(
            "mapSearchSuggestions"
        ).classList.add("hidden");

        return;
    }


    try {

        const response =
            await fetch(
                `/api/geocode?q=${encodeURIComponent(value)}`
            );


        const data =
            await response.json();


        if (!data.success) {
            return;
        }


        const locations =
            data.items || [];


        const box =
            getElement(
                "mapSearchSuggestions"
            );


        if (locations.length === 0) {

            box.innerHTML =
                `<div class="suggestion-empty">
                    No places found.
                </div>`;

            box.classList.remove(
                "hidden"
            );

            return;
        }


        let html = "";


        locations
            .slice(0, 5)
            .forEach(function (location, index) {

                html += `
                    <button
                        class="suggestion-item"
                        type="button"
                        data-map-result="${index}"
                    >

                        <span class="suggestion-pin">
                            ●
                        </span>

                        <span>

                            <b>
                                ${escapeHTML(
                                    (
                                        location.display ||
                                        ""
                                    ).split(",")[0]
                                )}
                            </b>

                            <small>
                                ${escapeHTML(
                                    location.display
                                )}
                            </small>

                        </span>

                    </button>
                `;
            });


        box.innerHTML =
            html;


        box.classList.remove(
            "hidden"
        );


        box
            .querySelectorAll(
                "[data-map-result]"
            )
            .forEach(function (button) {

                button.addEventListener(
                    "click",
                    function () {

                        const index =
                            Number(
                                button.dataset
                                    .mapResult
                            );


                        const location =
                            locations[index];


                        map.setView(
                            [
                                Number(
                                    location.lat
                                ),
                                Number(
                                    location.lng
                                )
                            ],
                            15
                        );


                        getElement(
                            "mapSearch"
                        ).value =
                            location.display;


                        box.classList.add(
                            "hidden"
                        );
                    }
                );
            });

    } catch (error) {

        console.log(
            "Map search error:",
            error
        );
    }
}


/* =========================================================
   LOAD ROUTE HISTORY
   ========================================================= */

async function loadHistory() {

    try {

        const response =
            await fetch(
                "/api/history"
            );


        /* User is not logged in */

        if (response.status === 401) {

            openAuth();

            return;
        }


        const data =
            await response.json();


        const historyList =
            getElement(
                "historyList"
            );


        if (
            data.items &&
            data.items.length > 0
        ) {

            let html = "";


            data.items.forEach(
                function (item) {

                    html += `
                        <div class="history-item">

                            <div>

                                <b>
                                    ${escapeHTML(
                                        item.start_text
                                    )}

                                    →

                                    ${escapeHTML(
                                        item.destination_text
                                    )}
                                </b>

                                <small>

                                    ${escapeHTML(
                                        item.mode
                                    )}

                                    ·

                                    ${escapeHTML(
                                        item.emergency_type ||
                                        "General"
                                    )}

                                    ·

                                    ${new Date(
                                        item.created_at
                                    ).toLocaleString()}

                                </small>

                            </div>

                            <span>
                                ${item.route_count}
                                routes
                            </span>

                        </div>
                    `;
                }
            );


            historyList.innerHTML =
                html;

        } else {

            historyList.innerHTML =
                `<div class="empty-state">
                    No saved routes yet.
                </div>`;
        }


        getElement("historyModal")
            .classList.remove("hidden");

    } catch (error) {

        showMessage(
            "Could not load route history.",
            true
        );
    }
}


/* =========================================================
   AUTHENTICATION
   ========================================================= */

function openLoginModal() {

    getElement("authModal")
        .classList.remove("hidden");
}


/* Show logged-in user */

function setUser(user) {

    getElement("signInBtn")
        .classList.add("hidden");


    getElement("accountBtn")
        .classList.remove("hidden");


    const name =
        user?.name || "User";


    const firstLetter =
        name
            .trim()
            .charAt(0)
            .toUpperCase();


    getElement("accountBtn")
        .textContent =
        firstLetter || "U";


    getElement("popoverAvatar")
        .textContent =
        firstLetter || "U";


    getElement("popoverName")
        .textContent =
        user?.name ||
        "ResQFlow user";


    getElement("popoverEmail")
        .textContent =
        user?.email ||
        "Signed in";
}


/* Check login status */

async function checkUserLogin() {

    try {

        const response =
            await fetch(
                "/api/auth/me"
            );


        const data =
            await response.json();


        if (data.authenticated) {

            setUser(
                data.user
            );
        }

    } catch (error) {

        console.log(
            "Login check failed"
        );
    }
}


/* Login / Register form */

async function submitAuth(event) {

    event.preventDefault();


    getElement("authMessage")
        .classList.add("hidden");


    const isRegister =
        authMode === "register";


    const userData = {

        email:
            getElement("authEmail")
                .value
                .trim(),

        password:
            getElement("authPassword")
                .value
    };


    if (isRegister) {

        userData.name =
            getElement("authName")
                .value
                .trim();
    }


    try {

        const url =
            isRegister
                ? "/api/auth/register"
                : "/api/auth/login";


        const response =
            await fetch(
                url,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify(
                            userData
                        )
                }
            );


        const data =
            await response.json();


        if (
            !response.ok ||
            !data.success
        ) {

            throw new Error(
                data.message ||
                "Authentication failed."
            );
        }


        setUser(
            data.user
        );


        getElement("authModal")
            .classList.add("hidden");


        getElement("authForm")
            .reset();


        showMessage(
            "Signed in successfully."
        );


        hideMessageAfterTime();

    } catch (error) {

        const authMessage =
            getElement(
                "authMessage"
            );


        authMessage.textContent =
            error.message;


        authMessage.classList.remove(
            "hidden"
        );
    }
}


/* Switch Login / Register */

function switchAuthMode(mode) {

    authMode = mode;


    getElement("loginTab")
        .classList.toggle(
            "active",
            mode === "login"
        );


    getElement("registerTab")
        .classList.toggle(
            "active",
            mode === "register"
        );


    getElement("nameField")
        .classList.toggle(
            "hidden",
            mode !== "register"
        );


    getElement("authSubmit")
        .textContent =
        mode === "register"
            ? "Create account"
            : "Sign in";
}


/* Logout */

async function logoutUser() {

    try {

        await fetch(
            "/api/auth/logout",
            {
                method: "POST"
            }
        );

    } catch (error) {

        console.log(
            "Logout error"
        );
    }


    getElement("accountBtn")
        .classList.add("hidden");


    getElement("signInBtn")
        .classList.remove("hidden");


    getElement("accountPopover")
        .classList.add("hidden");


    showMessage(
        "Signed out."
    );


    hideMessageAfterTime();
}


/* =========================================================
   ROUTE MODE
   ========================================================= */

function setRouteMode(mode) {

    getElement("mode").value =
        mode;


    document
        .querySelectorAll(".mode-pill")
        .forEach(function (button) {

            button.classList.toggle(
                "active",
                button.dataset.mode === mode
            );
        });


    /* Emergency type is only required
       in emergency mode */

    getElement("emergencyRow")
        .classList.toggle(
            "hidden",
            mode !== "emergency"
        );
}


/* =========================================================
   SORT ROUTES
   ========================================================= */

function sortRoutes() {

    if (!window.lastRouteData) {
        return;
    }


    const sortingOptions = [
        "best",
        "fastest",
        "shortest"
    ];


    let currentIndex =
        sortingOptions.indexOf(
            currentSort
        );


    currentIndex =
        (currentIndex + 1) %
        sortingOptions.length;


    currentSort =
        sortingOptions[currentIndex];


    const labels = {

        best: "Best",

        fastest: "Fastest",

        shortest: "Shortest"
    };


    getElement("sortBtn").innerHTML =
        labels[currentSort] +
        " <span>↕</span>";


    const routes = [];


    window.lastRouteData.analysis
        .forEach(function (analysis, index) {

            routes.push({

                analysis: analysis,

                route:
                    window.lastRouteData
                        .routes[index],

                oldIndex: index
            });
        });


    /* Best route */

    if (currentSort === "best") {

        routes.sort(
            function (a, b) {

                return (
                    (a.analysis.score || 0) -
                    (b.analysis.score || 0)
                );
            }
        );
    }


    /* Fastest route */

    else if (currentSort === "fastest") {

        routes.sort(
            function (a, b) {

                return (
                    a.analysis
                        .estimated_duration_s -
                    b.analysis
                        .estimated_duration_s
                );
            }
        );
    }


    /* Shortest route */

    else {

        routes.sort(
            function (a, b) {

                return (
                    a.analysis.distance_km -
                    b.analysis.distance_km
                );
            }
        );
    }


    /* Rebuild arrays */

    window.lastRouteData.routes =
        routes.map(
            function (item) {
                return item.route;
            }
        );


    window.lastRouteData.analysis =
        routes.map(
            function (item, index) {

                return {
                    ...item.analysis,

                    index: index,

                    status:
                        index === 0
                            ? "RECOMMENDED"
                            : "ALTERNATIVE"
                };
            }
        );


    window.lastRouteData.recommended_index =
        0;


    selectedRoute = 0;


    /* Redraw everything */

    drawRoutes(
        window.lastRouteData.routes,
        window.lastRouteData.analysis
    );


    displayRouteCards(
        window.lastRouteData.analysis
    );


    selectRoute(0);
}


/* =========================================================
   SIDEBAR NAVIGATION
   ========================================================= */

function setActiveSideButton(id) {

    document
        .querySelectorAll(".nav-item")
        .forEach(function (button) {

            button.classList.toggle(
                "active",
                button.id === id
            );
        });
}


/* Show home/search panel */

function showHomeView() {

    setActiveSideButton(
        "sideHomeBtn"
    );


    getElement("searchPanel")
        .classList.remove("hidden");


    getElement("reopenPanel")
        .classList.add("hidden");


    getElement("detailSheet")
        .classList.add("hidden");


    setTimeout(
        function () {

            map.invalidateSize();

        },
        100
    );
}


/* Show full map */

function showMapView() {

    setActiveSideButton(
        "sideMapBtn"
    );


    getElement("searchPanel")
        .classList.add("hidden");


    getElement("reopenPanel")
        .classList.remove("hidden");


    setTimeout(
        function () {

            map.invalidateSize();

        },
        100
    );
}


/* =========================================================
   SETTINGS
   ========================================================= */

function loadSettings() {

    const savedMode =
        localStorage.getItem(
            "resq_settings_mode"
        ) || "normal";


    getElement("settingsMode")
        .value =
        savedMode;


    getElement("settingsTraffic")
        .checked =
        localStorage.getItem(
            "resq_settings_traffic"
        ) !== "false";


    getElement("settingsSignals")
        .checked =
        localStorage.getItem(
            "resq_settings_signals"
        ) !== "false";


    getElement("settingsPanel")
        .checked =
        localStorage.getItem(
            "resq_settings_panel"
        ) !== "false";
}


/* Open settings */

function openSettings() {

    setActiveSideButton(
        "sideSettingsBtn"
    );


    loadSettings();


    getElement("settingsModal")
        .classList.remove("hidden");
}


/* Save settings */

function saveSettings() {

    const mode =
        getElement("settingsMode")
            .value;


    const traffic =
        getElement("settingsTraffic")
            .checked;


    const signals =
        getElement("settingsSignals")
            .checked;


    const panel =
        getElement("settingsPanel")
            .checked;


    /* Save in browser */

    localStorage.setItem(
        "resq_settings_mode",
        mode
    );


    localStorage.setItem(
        "resq_settings_traffic",
        traffic
    );


    localStorage.setItem(
        "resq_settings_signals",
        signals
    );


    localStorage.setItem(
        "resq_settings_panel",
        panel
    );


    /* Apply settings */

    setRouteMode(mode);

    trafficVisible = traffic;

    signalsVisible = signals;


    getElement("trafficToggle")
        .classList.toggle(
            "active",
            trafficVisible
        );


    getElement("signalsToggle")
        .classList.toggle(
            "active",
            signalsVisible
        );


    getElement("settingsModal")
        .classList.add("hidden");


    /* Redraw route */

    if (window.lastRouteData) {

        drawRoutes(
            window.lastRouteData.routes,
            window.lastRouteData.analysis
        );


        selectRoute(
            selectedRoute
        );
    }


    /* Show or hide panel */

    if (panel) {

        showHomeView();

    } else {

        showMapView();
    }


    showMessage(
        "Settings saved."
    );


    hideMessageAfterTime();
}


/* =========================================================
   DESKTOP + MOBILE NAVIGATION
   ========================================================= */

function setupNavigation() {

    /* Desktop */

    getElement("sideHomeBtn").onclick =
        showHomeView;


    getElement("sideMapBtn").onclick =
        showMapView;


    getElement("sideHistoryBtn").onclick =
        loadHistory;


    getElement("sideSettingsBtn").onclick =
        openSettings;


    /* Mobile */

    getElement("mobileHomeBtn").onclick =
        function () {

            setMobileButton(
                "mobileHomeBtn"
            );

            showHomeView();
        };


    getElement("mobileMapBtn").onclick =
        function () {

            setMobileButton(
                "mobileMapBtn"
            );

            showMapView();
        };


    getElement("mobileHistoryBtn").onclick =
        function () {

            setMobileButton(
                "mobileHistoryBtn"
            );

            loadHistory();
        };


    getElement("mobileSettingsBtn").onclick =
        function () {

            setMobileButton(
                "mobileSettingsBtn"
            );

            openSettings();
        };
}


/* Set active mobile button */

function setMobileButton(id) {

    document
        .querySelectorAll(".mobile-nav button")
        .forEach(function (button) {

            button.classList.remove(
                "active"
            );
        });


    getElement(id)
        .classList.add("active");
}


/* =========================================================
   CONNECT ALL BUTTONS
   ========================================================= */

function connectButtons() {

    /* Route form */

    getElement("routeForm")
        .addEventListener(
            "submit",
            calculateRoute
        );


    /* Route modes */

    document
        .querySelectorAll(".mode-pill")
        .forEach(function (button) {

            button.addEventListener(
                "click",
                function () {

                    setRouteMode(
                        button.dataset.mode
                    );
                }
            );
        });


    /* Map selection buttons */

    document
        .querySelectorAll("[data-target]")
        .forEach(function (button) {

            button.addEventListener(
                "click",
                function () {

                    chooseLocationFromMap(
                        button.dataset.target
                    );
                }
            );
        });


    /* Location */

    getElement("startLocate").onclick =
        getCurrentLocation;


    getElement("locateBtn").onclick =
        getCurrentLocation;


    getElement("swapLocations").onclick =
        swapLocations;


    /* Map controls */

    getElement("zoomIn").onclick =
        function () {
            map.zoomIn();
        };


    getElement("zoomOut").onclick =
        function () {
            map.zoomOut();
        };


    getElement("routeToggle").onclick =
        toggleRouteLines;


    getElement("trafficToggle").onclick =
        toggleTraffic;


    getElement("signalsToggle").onclick =
        toggleSignals;


    getElement("satelliteToggle").onclick =
        toggleSatellite;


    /* Satellite keyboard */

    getElement("satelliteToggle")
        .onkeydown =
        function (event) {

            if (
                event.key === "Enter" ||
                event.key === " "
            ) {

                event.preventDefault();

                toggleSatellite();
            }
        };


    /* Collapse panel */

    getElement("collapsePanel").onclick =
        function () {

            getElement("searchPanel")
                .classList.add("hidden");


            getElement("reopenPanel")
                .classList.remove("hidden");


            setTimeout(
                function () {

                    map.invalidateSize();

                },
                100
            );
        };


    /* Reopen panel */

    getElement("reopenPanel").onclick =
        showHomeView;


    /* ResQFlow logo */

    getElement("brandHome").onclick =
        function (event) {

            event.preventDefault();

            showHomeView();
        };


    /* Route results */

    getElement("clearBtn").onclick =
        clearRoute;


    getElement("sortBtn").onclick =
        sortRoutes;


    getElement("closeDetails").onclick =
        function () {

            getElement("detailSheet")
                .classList.add("hidden");
        };


    /* History */

    getElement("historyBtn").onclick =
        loadHistory;


    /* Login */

    getElement("signInBtn").onclick =
        openLoginModal;


    /* Account */

    getElement("accountBtn").onclick =
        function () {

            getElement("accountPopover")
                .classList.toggle("hidden");
        };


    getElement("popoverHistory").onclick =
        loadHistory;


    getElement("logoutBtn").onclick =
        logoutUser;


    /* Settings */

    getElement("saveSettings").onclick =
        saveSettings;


    /* Authentication */

    getElement("authForm")
        .addEventListener(
            "submit",
            submitAuth
        );


    getElement("loginTab").onclick =
        function () {

            switchAuthMode("login");
        };


    getElement("registerTab").onclick =
        function () {

            switchAuthMode("register");
        };


    /* Modal close buttons */

    document
        .querySelectorAll("[data-close]")
        .forEach(function (button) {

            button.onclick =
                function () {

                    const modalId =
                        button.dataset.close;


                    getElement(modalId)
                        .classList.add(
                            "hidden"
                        );
                };
        });
}


/* =========================================================
   MAP SEARCH INPUT
   ========================================================= */

function setupMapSearch() {

    const searchInput =
        getElement("mapSearch");


    searchInput.addEventListener(
        "input",
        function (event) {

            clearTimeout(
                mapSearchTimer
            );


            mapSearchTimer =
                setTimeout(
                    function () {

                        searchMapPlace(
                            event.target.value
                        );

                    },
                    300
                );
        }
    );


    searchInput.addEventListener(
        "keydown",
        function (event) {

            if (event.key === "Enter") {

                searchMapPlace(
                    event.target.value
                );
            }
        }
    );
}


/* =========================================================
   CLOSE DROPDOWNS WHEN CLICKING OUTSIDE
   ========================================================= */

function setupOutsideClick() {

    document.addEventListener(
        "click",
        function (event) {

            /* Map search */

            if (
                !event.target.closest(
                    ".map-search"
                )
            ) {

                getElement(
                    "mapSearchSuggestions"
                ).classList.add(
                    "hidden"
                );
            }


            /* Account menu */

            if (
                !event.target.closest(
                    ".account-popover"
                ) &&
                !event.target.closest(
                    "#accountBtn"
                )
            ) {

                getElement(
                    "accountPopover"
                ).classList.add(
                    "hidden"
                );
            }


            /* Start and destination */

            ["start", "end"].forEach(
                function (target) {

                    if (
                        !event.target.closest(
                            "#" +
                            target +
                            "Input"
                        ) &&
                        !event.target.closest(
                            "#" +
                            target +
                            "Suggestions"
                        )
                    ) {

                        getElement(
                            target +
                            "Suggestions"
                        ).classList.add(
                            "hidden"
                        );
                    }
                }
            );
        }
    );
}


/* =========================================================
   RESPONSIVE MAP
   ========================================================= */

function setupWindowResize() {

    window.addEventListener(
        "resize",
        function () {

            if (map) {

                map.invalidateSize({
                    pan: false
                });
            }
        }
    );
}


/* =========================================================
   MAIN INITIALIZATION
   ========================================================= */

function initializeApp() {

    console.log(
        "ResQFlow application started."
    );


    /* Start map */

    initializeMap();


    /* Check logged-in user */

    checkUserLogin();


    /* Location search */

    setupLocationInput("start");

    setupLocationInput("end");


    /* Navigation */

    setupNavigation();


    /* Buttons */

    connectButtons();


    /* Map search */

    setupMapSearch();


    /* Outside click */

    setupOutsideClick();


    /* Resize */

    setupWindowResize();


    /* Load saved settings */

    const savedMode =
        localStorage.getItem(
            "resq_settings_mode"
        ) || "normal";


    setRouteMode(
        savedMode
    );


    trafficVisible =
        localStorage.getItem(
            "resq_settings_traffic"
        ) !== "false";


    signalsVisible =
        localStorage.getItem(
            "resq_settings_signals"
        ) !== "false";


    getElement("trafficToggle")
        .classList.toggle(
            "active",
            trafficVisible
        );


    getElement("signalsToggle")
        .classList.toggle(
            "active",
            signalsVisible
        );


    console.log(
        "ResQFlow is ready."
    );
}


/* =========================================================
   START APPLICATION
   ========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    initializeApp
);


