#!/bin/sh

# ResQFlow Dijkstra Module

# This file compiles the C Dijkstra program.

set -e

echo "================================"
echo " ResQFlow - Building DSA Module"
echo "================================"
echo

# Check whether the C file exists

if [ ! -f "dsa_algorithms.c" ]; then
echo "Error: dsa_algorithms.c not found."
exit 1
fi

# Compile the C program

echo "Compiling dsa_algorithms.c..."

gcc dsa_algorithms.c -o dsa_algorithms

echo
echo "Dijkstra module built successfully."
echo "Output file: dsa_algorithms"

