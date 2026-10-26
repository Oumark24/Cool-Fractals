An interactive Mandelbrot set made for Hack Club. The fractal is drawn by the program itself, not pasted in as an image. You can zoom, pan around, change the colors, and jump to a few interesting places.

Why I made it

I like that fractals sit somewhere between math and art. The closer you look, the more detail appears, so I wanted to make something people could explore for themselves. Its also my first Hack Club project.

How it works

Each point on the screen becomes a complex number. The program repeatedly applies z = z² + c. If the value escapes a certain distance, the point gets colored by how quickly it escaped. Repeating that for every pixel creates the Mandelbrot set and its detailed edge.

Try it

Open the live demo: [link added after publishing]. No account or install should be needed.

Controls

Zoom with the mouse wheel or pinch, drag to move, and use reset and saved-view buttons to explore.

Rebuild it

I’d aim for plain HTML, CSS, and some JavaScript, with no packages or API keys. That keeps the live demo one click and lets someone download the repo and open the project without a big setup