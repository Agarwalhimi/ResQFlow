#!/bin/sh

# Install required Python packages
python3 -m pip install -r requirements.txt

# Build the C Dijkstra program
./build_dsa.sh

# Start the Flask application
python3 app.py