// Nine-point circle in Asymptote (olympiad.asy). Drag A, B or C along the circumcircle.
import olympiad;
import geometry;
size(8cm);

pair A = dir(110), B = dir(210), C = dir(330);
pair H = orthocenter(A, B, C);
pair D = foot(A, B, C), E = foot(B, C, A), F = foot(C, A, B);
pair N = (circumcenter(A, B, C) + H)/2;

draw(unitcircle, gray);
draw(A--B--C--cycle);
draw(A--D, dashed);
draw(B--E, dashed);
draw(C--F, dashed);
draw(circumcircle(D, E, F), blue);
draw(rightanglemark(A, D, B));

dot("$A$", A, dir(A));
dot("$B$", B, dir(B));
dot("$C$", C, dir(C));
dot("$H$", H, NE);
dot("$N$", N, S);
dot("$D$", D, S);
dot("$E$", E, NE);
dot("$F$", F, NW);
