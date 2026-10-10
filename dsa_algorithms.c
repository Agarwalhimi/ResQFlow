#include <stdio.h>
#include <stdlib.h>
#include <limits.h>

#define MAX 100

// Structure for storing one connected edge
typedef struct
{
int to;
int weight;
} Edge;

int main(int argc, char *argv[])
{
/*
The program needs 3 arguments:

```
   1. graph.csv
   2. source node
   3. destination node

   Example:
   dsa_algorithms graph.csv 0 5
*/

if (argc < 4)
{
    fprintf(stderr,
            "Usage: dsa_algorithms graph.csv source target\n");

    return 2;
}

/* Open the graph file */
FILE *file = fopen(argv[1], "r");

if (file == NULL)
{
    perror("Could not open graph file");
    return 3;
}

/*
   Adjacency list:

   adj[node][edge]

   deg[node] stores the number of edges
   connected to that node.
*/
Edge graph[MAX][MAX];

int degree[MAX] = {0};
int nodeCount = 0;

int from;
int to;
int weight;

/*
   Read the graph.csv file.

   Format:
   source,destination,weight
*/
while (fscanf(file, "%d,%d,%d",
              &from, &to, &weight) == 3)
{
    /* Ignore invalid nodes */
    if (from < 0 || to < 0 ||
        from >= MAX || to >= MAX)
    {
        continue;
    }

    /* Add edge from -> to */
    graph[from][degree[from]].to = to;
    graph[from][degree[from]].weight = weight;
    degree[from]++;

    /* Add reverse edge because the graph is undirected */
    graph[to][degree[to]].to = from;
    graph[to][degree[to]].weight = weight;
    degree[to]++;

    /* Find total number of nodes */
    if (from + 1 > nodeCount)
    {
        nodeCount = from + 1;
    }

    if (to + 1 > nodeCount)
    {
        nodeCount = to + 1;
    }
}

fclose(file);

/* Read source and destination */
int source = atoi(argv[2]);
int target = atoi(argv[3]);

/* Check source and destination */
if (source < 0 || target < 0 ||
    source >= nodeCount || target >= nodeCount)
{
    fprintf(stderr, "Invalid source or target node.\n");
    return 4;
}

/*
   distance[i] = shortest distance from source to node i

   previous[i] = previous node in the shortest path

   visited[i] = tells whether the node has already
                been processed
*/
int distance[MAX];
int previous[MAX];
int visited[MAX] = {0};

/* Initially all distances are infinity */
for (int i = 0; i < nodeCount; i++)
{
    distance[i] = INT_MAX;
    previous[i] = -1;
}

/* Distance from source to itself is 0 */
distance[source] = 0;

/*
   Dijkstra's Algorithm
*/
for (int count = 0; count < nodeCount; count++)
{
    int current = -1;

    /* Find the unvisited node with minimum distance */
    for (int i = 0; i < nodeCount; i++)
    {
        if (!visited[i] &&
            (current == -1 ||
             distance[i] < distance[current]))
        {
            current = i;
        }
    }

    /* No more reachable nodes */
    if (current == -1 ||
        distance[current] == INT_MAX)
    {
        break;
    }

    /* Mark current node as visited */
    visited[current] = 1;

    /*
       Check all neighbours of the current node
    */
    for (int i = 0; i < degree[current]; i++)
    {
        int next = graph[current][i].to;
        int edgeWeight = graph[current][i].weight;

        /*
           If going through the current node gives
           a shorter path, update the distance.
        */
        if (distance[current] + edgeWeight <
            distance[next])
        {
            distance[next] =
                distance[current] + edgeWeight;

            previous[next] = current;
        }
    }
}

/* Check whether a path exists */
if (distance[target] == INT_MAX)
{
    printf("No path found\n");
    return 0;
}

/*
   Store the shortest path.

   We start from the destination and move backwards
   using the previous[] array.
*/
int path[MAX];
int pathLength = 0;

int current = target;

while (current != -1)
{
    path[pathLength] = current;
    pathLength++;

    current = previous[current];
}

/* Display result */
printf("\n");
printf("Dijkstra Shortest Path\n");
printf("----------------------\n");

printf("PATH: ");

for (int i = pathLength - 1; i >= 0; i--)
{
    printf("%d", path[i]);

    if (i != 0)
    {
        printf(" -> ");
    }
}

printf("\n");
printf("COST: %d\n", distance[target]);

return 0;


}
