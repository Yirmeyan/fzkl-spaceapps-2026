"""Answers of VizieR, as its service writes them, for the tests of the catalogs."""

_HEAD = """#
#   VizieR Astronomical Server vizier.cfa.harvard.edu
#    Date: 2026-11-14T23:24:47 [V7.6.1]
#
#Coosys\tJ2000:\teq_FK5 J2000
#INFO\tservice_protocol=ASU\t  IVOID of the protocol through which the data was retrieved
#INFO\tpublisher=CDS\t  Data centre that produced the VOTable
"""

_GAIA_TABLE = """
#RESOURCE=yCat_1355
#Name: I/355
#Title: Gaia DR3 Part 1. Main source (Gaia Collaboration, 2022)
#Coosys\tH_2016.000:\tICRS
#Table\tI_355_gaiadr3:
#Name: I/355/gaiadr3
#Title: Gaia DR3 source catalog (1811709771 sources)
#Column\tDR3Name\t(a28)\tUnique source designation (designation)\t[ucd=meta.id]
#Column\tRA_ICRS\t(F15.11)\tRight ascension (ICRS) at Ep=2016.0 (ra)\t[ucd=pos.eq.ra;meta.main]
"""

_GAIA_NAMES = """DR3Name\tRA_ICRS\tDE_ICRS\tpmRA\tpmDE\tPlx\te_Plx\tGmag
 \tdeg\tdeg\tmas/yr\tmas/yr\tmas\tmas\tmag
----------------------------\t---------------\t---------------\t---------\t---------\t---------\t-------\t---------
"""

BARNARD_LINE = (
    "Gaia DR3 4472832130942575872\t269.44850252544\t+04.73942005111"
    "\t -801.551\t10362.394\t 546.9759\t 0.0401\t 8.193974\n"
)
NEIGHBOR_LINE = (
    "Gaia DR3 4472832165289153024\t269.46646068714\t+04.70557281066"
    "\t    0.578\t   -8.671\t   1.8140\t 0.0219\t11.451174\n"
)
# A faint source: Gaia gives it a place and a brightness, nothing else.
FAINT_LINE = (
    "Gaia DR3 4472832130938939136\t269.44910311026\t+04.69946489863"
    "\t         \t         \t         \t       \t20.989813\n"
)

GAIA_ANSWER = _HEAD + _GAIA_TABLE + _GAIA_NAMES + BARNARD_LINE + NEIGHBOR_LINE + FAINT_LINE + "\n"
# A cone with no source: the table is described, and has no line.
EMPTY_ANSWER = _HEAD + _GAIA_TABLE
REFUSED_ANSWER = _HEAD + "#INFO\tError=Table 'nothing' does not exist in catalog: I/355\t\n"

# The second source has no brightness at 3.4 micrometers: its last cell is blank.
ALLWISE_ANSWER = (
    _HEAD
    + """
#RESOURCE=yCat_2328
#Name: II/328
#Title: AllWISE Data Release (Cutri+ 2013)
#Table\tII_328_allwise:
#Name: II/328/allwise
#Title: *the AllWISE data release (among 747,634,026 sources)
AllWISE\tRAJ2000\tDEJ2000\tW2mag\tW1mag
 \tdeg\tdeg\tmag\tmag
-------------------\t-----------\t-----------\t------\t------
J175747.94+044323.8\t269.4497700\t+04.7232800\t 3.658\t 4.358
"""
    + "J175734.10+044619.8\t269.3921130\t+04.7721716\t 9.435\t      \n\n"
)


def gaia_answer(*lines: str) -> str:
    """An answer of Gaia DR3 with the lines given."""
    return _HEAD + _GAIA_TABLE + _GAIA_NAMES + "".join(lines) + "\n"
