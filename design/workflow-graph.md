# Workflow Graph Revamp

## Context
The current workflow graph does not leverage any graphing libraries and everything is hand-rolled.  The current workflow graph implementation is now very difficult to work with, prone to various errors, and lacks flexibility.  A new solution needs to be implemented to split the workflow graph into distinct areas of concern: 
- core graph data that is compatible with various graphing libraries for leveraging graph algorithms
- graph layout composition that can leverage different graph layout libraries and algorithms
- graph rendering that also supports user interactions

## Status
- April 2, 2025: Proposal submitted

## Proposal
The workflow graph is provided by the event API and requires a set of utility functions/utility class to convert them into a format that a third-party graph algorithm library can consume.  As the workflow graph is a simple and small DAG, all/most third-party graph libraries can be used.  The main graph library functions of concern would be:
- traversal algorithms 
- subgraph extraction
- root/leaf node determination
- graph reversal

Graph layout libraries should be used in favor of manually positioning the nodes.  Selection of a correct layout algorithm is the most challenging aspect as many general graph layouts are for generalized graphs.  The workflow graph is more of tree-structure, so it is highly desirable to focus on those layout algorithms.

Rendering the graph and supporting various user interactions should be offloaded to a third-party library.  Currently, D3 is used and does have support for these features; however, we may be able to streamline the rendering layer by using another library for the near-term.

With the above points in mind, the current proposal for updating the workflow graph is as follows:
- graph layout library options
  - ELK
  - dagre
- graph rendering
  - cytoscape
    - extension for the elk layout
    - extension for the dagre layout -- the plugin is not actively developed and a few years out of date.  Using dagre for the layout algorithm will be best served by porting the old plugin or coming up with a new shim layer
    - extension for collapsing and expanding compound nodes
    - extensions for different context menus and user interactions
- additional graph utility functions
  - graphology

## Resources
- [Cytoscape.js](https://js.cytoscape.org/)
- [Cytoscape expand and collapse compound nodes](https://github.com/iVis-at-Bilkent/cytoscape.js-expand-collapse)
- [Cytoscape ELK layout](https://github.com/cytoscape/cytoscape.js-elk)
- [Cytoscape dagre layout](https://github.com/cytoscape/cytoscape.js-dagre)
- [dagre](https://github.com/dagrejs/dagre)
- [Graphology](https://graphology.github.io/)
